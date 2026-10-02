# Groovy Operations — Claude session notes

Multi-file SPA, deployed to Netlify on every push to `main`.
Two contributors: Afnan (HRM/operations side, with Claude) and Ammar Shah
(printing/embellishments side, also with Claude on a separate session).

## Standing rule — delegate the work (Afnan, 28 Sept 2026)

1. **Never do the work yourself.**
2. **Always hand it over to a sub agent.**

The main session plans, briefs, reviews what comes back and reports to
Afnan; the reading, writing, testing and fixing is done by sub agents
(the Agent tool), each given a complete, standalone brief.

## Ground rule — verify, never guess

**Every factual claim must trace to a tool result, a file, or a command run
in this session. If it wasn't verified, it does not get stated as fact.**

This is a standing instruction from Afnan, not a style preference. It exists
because of two real failures during the PWA work, both avoidable:

- A Netlify preview URL was *constructed* from the branch name and handed
  over as though it were real. It 404'd and wasted the user's time. The
  correct URL was one API call away the entire time (see the table below).
- A failing Netlify build was diagnosed — and a fix pushed — without ever
  reading the actual error. It went green, but that was luck, not diagnosis.

### The rules

1. **Never hand over a URL, ID, path, or config value you constructed.**
   Read it from a tool result. If you genuinely must infer one, label it
   "inferred, unverified" in the same sentence, and verify before acting.
2. **Never diagnose from a symptom you have not read.** No log, no
   diagnosis. If the error text isn't in front of you, say "I can't see the
   error, send me the last 20 lines" — do not ship a fix for a hypothesis.
3. **Label confidence every time.** Either "verified: `<source>`" or
   "hypothesis, unverified". Never let the second wear the first's clothes.
4. **Verify before reporting something done**, not after being challenged.
5. **"I don't know" and "I can't check that from here" are correct
   answers** — always preferred over a confident guess.

### Verification paths that actually work here

| To check | Use |
|---|---|
| Deploy status + the **real** preview URL, **on a PR** | GitHub MCP `pull_request_read`, `method:"get_status"` — returns Netlify's own `target_url` and pass/fail |
| Whether a push to `main` actually SHIPPED | **Ask the human for the Netlify deploy list.** There are NO commit statuses on direct pushes to this repo — checked against a commit that *was* published, and it has none either, so a clean status API says nothing. *(29 Sept 2026: what is SERVED can now be read from a session — `curl` `https://groovyoperations.netlify.app/sw.js` and the changed `/js/*.js`, compare `CACHE_VERSION` and `md5sum` with `git show origin/main:<file>`. Verified 29 Sept: `sw.js`, `index.html`, `js/master-accounts.js` and `js/ma-core.js` came back byte-identical to `origin/main`'s. That shows a build with those bytes is live; it does not show the deploy list, a later skipped deploy, or which commit built it.)* |
| Whether CI passed on a push | `api.github.com/repos/.../commits/<sha>/check-runs` (unauthenticated works; this repo is public) |
| CI / check-run detail | `pull_request_read`, `method:"get_check_runs"` |
| Whether something is merged | `git fetch` then `git merge-base --is-ancestor`, or `pull_request_read` `method:"get"` (`merged` field) |
| Static files serve | `python3 -m http.server` at repo root + `curl -o /dev/null -w "%{http_code}"` |
| JS parses | `node --check <file>` |
| `netlify.toml` valid | `python3 -c "import tomllib;tomllib.load(open('netlify.toml','rb'))"` |
| `manifest.json` valid | `python3 -c "import json;json.load(open('manifest.json'))"` |

**A DEPLOY CAN BE SILENTLY SKIPPED, AND IT LOOKS EXACTLY LIKE A STALE
CACHE (21 Sept 2026).** Afnan reported four rounds of Mood Boards work
missing after a hard refresh. Measured from his screenshot in headless
Chromium rather than guessed: the rail was 74px, the top bar 44px and the
Unsorted tray 223px — all exactly 0.80x their CSS values, so the browser
was at 80% zoom, and at that scale the tray's 223px is 279 CSS px. The
shipped tray is 380; the PRE-change one was **280**. Three constants
agreeing on one scale factor is what made it a measurement instead of a
hunch, and the Hand tool being present pinned the build to exactly `v142`.

The cause was neither the cache nor the code: Netlify had **skipped every
deploy after `5ae868e` with "account credit usage exceeded"** — seven
commits, across BOTH tracks, queued as Skipped rather than failing. The
site served v142 because v143-v148 were never built. **Skipped deploys do
not retry themselves**; once credits are restored someone has to press
Trigger deploy on the newest commit.

- **The tell:** a hard refresh that changes nothing, while `git` says the
  work is on `origin/main`. A stale service worker and an unbuilt deploy
  produce the identical symptom from the browser's side.
- **The check is the Netlify deploy list, and only the human can see it** —
  ~~`*.netlify.app` is blocked here (re-verified, not inherited)~~
  **SUPERSEDED 29 Sept 2026: `groovyoperations.netlify.app` answers from a
  session** (HTTP 200, `server: Netlify` — see the re-check under "Sandbox
  limits"), so a served page can be read. The deploy LIST is a view in
  Netlify's dashboard/API, not a page on the site, and that route was not
  tried on 29 Sept, so it is still the human's to read. And this
  repo carries no Netlify commit statuses at all.
- **Do not diagnose this from the code.** Nothing in `js/boards.js` or
  `css/main.css` was ever wrong; both were verified against `origin/main`
  before the deploy list was asked for, which is the only reason the
  billing answer was recognisable when it arrived.

### Sandbox limits (verified, reproducible)

~~The Claude sandbox **cannot reach `*.netlify.app`** — the egress proxy
answers `403` to `CONNECT` (`connect_rejected`). The deployed site can
therefore never be opened from a session.~~ **SUPERSEDED 29 Sept 2026 — see
the re-check below.** Check deploys via the GitHub
status API above, and depend on the human for anything needing a real
browser: install prompts, offline behaviour, visual confirmation.

~~The sandbox **also cannot reach `*.firebaseio.com`** (same `connect_rejected`
403), so live Realtime Database rules can never be verified by curling the
REST endpoint from here — despite `firestore.googleapis.com` itself being
reachable.~~ **SUPERSEDED 29 Sept 2026: the app's RTDB host answers from a
session (re-check below).** To verify RTDB rules actually took effect, use Firebase Console
→ Realtime Database → Rules → **Rules playground** (simulate an
unauthenticated read) and have the human report the result.
`api.github.com` and `firestore.googleapis.com` **are** reachable.

~~**Blocked: `www.gstatic.com`, `cdnjs.cloudflare.com`, `cdn.jsdelivr.net`,
`unpkg.com`, and `cloudinary.com` ENTIRELY** — not just
`res.cloudinary.com`; `cloudinary.com/documentation` and
`support.cloudinary.com` answer `403` to `CONNECT` as well (verified Sept
2026 via `curl` and a headless Chromium launch). So nothing about a
Cloudinary account, its settings or its docs can be checked from a session —
that always needs the human.~~ **SUPERSEDED 29 Sept 2026 — every one of
those hosts answered; see the re-check below.** **Reachable: `api.github.com`,
`firestore.googleapis.com`, `registry.npmjs.org`, `raw.githubusercontent.com`.**

**RE-CHECKED 29 Sept 2026 — EVERY HOST NAMED ABOVE ANSWERS, and the "blocked"
wording above is SUPERSEDED.** Verified: `curl -sS -o /dev/null -m 20 -w
"%{http_code}" https://HOST/` run from a session through its own proxy
(`HTTPS_PROXY`, CA bundle `/root/.ccr/ca-bundle.crt`; no `-k`, the proxy not
bypassed). A status from the origin means the proxy let the request through.
`curl` exited 0 for every host, and the proxy's own status endpoint
(`/__agentproxy/status`) listed no host from this table among its
`recentRelayFailures`.

| Host | Result |
|---|---|
| `groovyoperations.netlify.app` | `/` 200, `server: Netlify` |
| `www.gstatic.com` | `/` 404 from the origin (`server: sffe`); the four Firebase SDK files `index.html` imports, `/firebasejs/10.12.2/firebase-{app,firestore,auth,database}.js`, each 200 (101,721 / 436,574 / 150,996 / 186,299 bytes) |
| `cdnjs.cloudflare.com` | `/` 200; `/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js` 200 (364,463 bytes) |
| `cdn.jsdelivr.net`, `unpkg.com` | `/` 301, 200 |
| `cloudinary.com` | `/` 200; `/documentation` 200; `support.cloudinary.com/` 302 |
| `res.cloudinary.com` | `/` 404 from the origin (`server: Cloudinary`) |
| `api.github.com`, `raw.githubusercontent.com`, `registry.npmjs.org` | 200, 301, 200 |
| `firestore.googleapis.com`, `identitytoolkit.googleapis.com`, `securetoken.googleapis.com` | `/` 404 from the origin, each |
| `groovy-gatepass-default-rtdb.firebaseio.com` (the `databaseURL` in `index.html`) | GET `/` 301; an unauthenticated GET of `/attendance.json?shallow=true` **401** (status read, body discarded) |
| `storage.googleapis.com` (named in the emulator paragraph below) | `/` 400 from the origin |

- **What the RTDB row does and does not show.** The host is reachable, and one
  unauthenticated read of one path was refused — consistent with `database.rules.json`'s
  `attendance` `.read: auth != null`. It shows nothing about the rules TEXT, about a
  signed-in read, or about writes; the Rules playground sentence above still stands for those.
- **Only one `*.netlify.app` host and one `*.firebaseio.com` host were tried**, the app's
  own; the wildcards in the old wording were not tested beyond those. A 404/400 on `/` from an
  API host is a reachability result, not a refusal.
- **A build id can be read from the live site now, which is not the deploy list.**
  `https://groovyoperations.netlify.app/sw.js` returned 200 and
  `CACHE_VERSION = 'v259'` on 29 Sept 2026, the same value as this checkout's `sw.js`. It does
  not by itself say which commit is live. **Re-read at 16:39 UTC (verified: this run's GETs
  and `md5sum` against `git show origin/main:<file>`):** `sw.js`, `index.html`,
  `js/master-accounts.js` and `js/ma-core.js` were byte-identical to `origin/main`'s, and the
  served `index.html` carries the two Master Accounts script tags.
- **Cloudinary:** its public docs pages answer (above). Reading an ACCOUNT's settings would
  still need a Cloudinary login; none was tried, so that stays the human's.
- **Node's built-in `fetch` does not read `HTTPS_PROXY`** — verified: `/root/.ccr/README.md`
  ("Tool ignores the proxy entirely") says so and says to run that command with
  `NODE_USE_ENV_PROXY=1` on Node >= 22.21; `node --version` here is v22.22.2. What was
  actually observed on 29 Sept: `fetch` from Node to `identitytoolkit.googleapis.com` and
  `firestore.googleapis.com` returned the origin's 404 both with and without the variable, so
  for those two hosts it was not needed; an unproxied `fetch` to `api.github.com` was answered
  by GitHub itself (403, its unauthenticated rate-limit message) while the proxied one got 200.
  Keep the variable in Node commands anyway, as the README says.

**What changed in Sept 2026:** jsPDF/SheetJS/JsBarcode are no longer loaded
from a CDN — they are vendored under `/assets/vendor` (see "Vendored
libraries" below), fetched from `registry.npmjs.org`, which IS reachable.
So **`node tests/smoke-browser.js` now loads the whole app in real headless
Chromium** (`/opt/pw-browsers/*/chrome-linux/chrome`) and verifies every
classic script executes, every expected global exists, and all three
libraries actually work. That was impossible before.

~~**Still not possible: signing in or rendering a page.** The Firebase modular
SDK loads from `gstatic.com`, which is still blocked, so `__bootApp()` never
runs and the app stops at the login screen's static HTML. **A "verify in a
browser" step for any UI change is therefore still NOT possible from this
sandbox** — say so explicitly rather than skip the caveat.~~ **SUPERSEDED 29
Sept 2026 — see the two paragraphs below; what is still not possible is
listed after them.** Real UI verification needs the human, a phone, or
Claude in Chrome.

**29 Sept 2026 — the premise of that paragraph no longer holds.** Verified: `curl`
fetched all four Firebase SDK files `index.html` imports from `www.gstatic.com` (see
the re-check above), so "gstatic.com, which is still blocked" is SUPERSEDED.
~~**Whether the app now boots (`__bootApp()` runs), signs in, or renders a page from this
sandbox has NOT been tested** — so "still NOT possible" is neither confirmed nor refuted
here; read it as untested until a later dated entry says otherwise.~~ **SUPERSEDED 29 Sept
2026 (later): it has been tested — next paragraph.** The same gstatic
premise is repeated, and now marked, in "Vendored libraries" (reason 3), the Mood Boards
Trash and Dark-mode notes, and the `tests/smoke-browser.js` entry; ~~the many other "the
sandbox cannot sign in" remarks in this file share the untested conclusion and are
left as written.~~ **SUPERSEDED 29 Sept 2026 (later): every present-tense "the sandbox
cannot sign in" clause now carries the tag `[29 Sept: a headless QA session can sign in and
render — see "Sandbox limits"]` right after it (41 tags, inserted by one script and checked:
removing them gives the previous file byte for byte). Five were rewritten by hand instead: this
paragraph, the Mood Boards Trash note, the Dark-mode note, the Master Accounts "Nobody has
opened" bullet and the `tests/smoke-browser.js` entry. The "Nobody has … on a real screen"
sentences they sit in stay TRUE — no human has looked — only the stated reason changed.**

**VERIFIED FROM A SESSION, 29 Sept 2026 (later) — a headless Chrome in a session signed in
to the LIVE app as the QA account and rendered the Board page.** Source: `tests/e2e/board.e2e.js`
run against `https://groovyoperations.netlify.app` (serving `v259`) at checkout `a436e8b`,
through the real login form — read from that run's own files, `docs/board-screens/a436e8b/
report.md` and `report.json` (gitignored, not in the repo) and its stdout. Exit 1, **6 of 7
checks passed**: signed in with the `qa` role; signed in WITHOUT Remember me; writes to `pos`
and `bug_reports` refused with `permission-denied` (the run's own check that `isQa()` is
deployed); the Board's sandbox list is private, QA-flagged and has exactly one member, the uid
pinned in the repo's `isQa()` (compared, not written here); the composer takes the caret.
**0 page errors, 0 console errors.** The 7th check failed on a permission refusal (analysed under
"QA debug access"), not on anything in the browser. The Firebase SDK the login needs is imported
from `www.gstatic.com` (verified: `index.html`), so that host was reached from the session, which
agrees with the table above.
- **What that run does NOT show.** It stopped before its screen matrix: `report.json` has
  `screens: []` and no screenshots were made, and it is the Board's harness, so it drove the
  Board and no other page. **A walk of the other pages was not part of it and is not recorded
  here — "the whole app renders cleanly from a session" is NOT claimed.** Nor does it show what a
  human sees.
- **It needs** `GROOVY_QA_URL`, `GROOVY_QA_EMAIL` and `GROOVY_QA_PASSWORD` in the environment
  (verified: set/not-set on 29 Sept; values never printed or written), a Chrome binary, and a
  Node with a global `WebSocket` (22+) — from the header of `tests/e2e/board.e2e.js`, which also
  says it exits 0 having done nothing when one is missing.
- **Environment prerequisite — reported by that run, not re-run here.** Its first attempt
  (0 of 1, "timed out waiting for the login form", from the session's saved stdout — the
  scratchpad, not the repo) failed because headless Chrome did not trust the session proxy's CA:
  the Chrome stderr saved then (same place) shows SSL handshake failures with `net_error -202`
  (Chrome's `ERR_CERT_AUTHORITY_INVALID` — from Chrome's error list, not from a tool result
  here). It was fixed by adding the proxy's public CA (`/root/.ccr/agent-proxy-ca.crt`) to
  Chrome's NSS store (`~/.pki/nssdb`); TLS verification stayed ON. `/root/.ccr/README.md` says the browser NSS store is "already set up",
  so this is a discrepancy to check first, not to assume: a session that meets
  `ERR_CERT_AUTHORITY_INVALID` in Chrome should look at that store before anything else.

**STILL not possible or unverified from a session (29 Sept 2026):**
- **A human's visual judgement** of any page, and every "Nobody has … on a real screen" note in
  this file — those stay true.
- **Real-phone behaviour:** the on-screen keyboard, install prompts and the installed PWA,
  offline use, Share-menu targets, WebAuthn/fingerprint dialogs. No session has driven a phone.
- **Cloudinary ACCOUNT settings** — plan, upload cap, PDF/ZIP and authenticated delivery,
  `overwrite=0`. The public hosts answer; an account view needs its login.
- **The Netlify deploy LIST** (built, skipped or failed, and for which commit). What is SERVED
  can be read and compared with git (row "Whether a push to `main` actually SHIPPED"); the
  list is a dashboard/API view that was not tried.
- **What the Firebase Console has published, as TEXT.** Behaviour can be probed as the QA
  account (sign-in works; REST lists and creates), which says how the live rules answer those
  requests, not whether the published file equals the repo's.
- **Owner-only pages with real data:** the QA account is refused on Master Accounts (`ma_*`)
  by design and is not on `_MA_USERS`, so a QA session cannot open those pages against live data.
- **Hosts other than those in the re-check table** — Milanote, Pexels, Openverse, Unsplash,
  Pinterest, Spotify, SoundCloud, Google Maps and the licensed Pantone books — were NOT
  re-checked; the remarks elsewhere that call them unreachable are unknown, not verified.
- **Comments in other files still carry the superseded premise** (a `grep -rn` on 29 Sept found
  "cannot reach `*.netlify.app` / Cloudinary / gstatic" or "the sandbox cannot sign in" in
  `BOARD.md`, `BOARD-LOG.md`, `PATTERN_HUB_PLAN.md`, `MASTER_ACCOUNTS_PLAN.md`, `tests/README.md`,
  `tests/harness.js`, `tests/smoke-layout.js`, `tests/ma-attach.test.js`, `tests/ma-server.test.js`,
  `tests/e2e/board.e2e.js` (header), `js/boards.js`, `netlify/lib/ma-server.js` and
  `netlify/functions/image-search.js`) — this change edited only `CLAUDE.md`, `QA_ACCESS.md` and the
  header comment of `tests/smoke-browser.js`. Read those remarks with this section's correction.

**THE FIRESTORE EMULATOR DOES RUN HERE (verified 25 Sept 2026)**, which
this file never said and which changes what "the rules are unverifiable"
means. Java 21 is installed, `firebase-tools` and
`@firebase/rules-unit-testing` install from `registry.npmjs.org`, and the
emulator jar downloads (from `storage.googleapis.com`, reachable). So a
rules FILE can be exercised for real, by the Firestore rules engine itself,
instead of only being read as text. **`tests/rules-emulator.js`** does this
for `wh_sales` (32 checks, every document built by the app's own
`whsBuildSale`); its header has the exact commands. It is not a
`*.test.js` — CI installs nothing, so `tests/run.js` must not pick it up —
and it runs under a `demo-` project id, so it cannot reach
`groovy-gatepass`. **What it cannot tell you is what the Console has
PUBLISHED** — that is still a question only the human can answer.

## File architecture (split from the old single `index.html`)

```
/index.html          shell only: <head>, CSS link, body DOM (login/setup/app),
                     CDN libs, ordered <script src> tags, and ONE inline
                     <script type="module"> that imports the Firebase modular
                     SDK, bridges db/auth/rtdb + all Firestore/RTDB fns onto
                     window, then calls window.__bootApp().
/manifest.json       PWA manifest (standalone, portrait, black theme).
                     Icons live in /assets/icons/.
/sw.js               service worker — precache + offline caching. See
                     "PWA / offline caching" below before editing.
/css/main.css        all styles (extracted verbatim).
/js/shared.js        constants, generic utils (showToast, _icon,
                     formatTime12hr, logActivity, uploadToCloudinary), nav
                     (buildNav, mob nav, sheets), router (showPage,
                     renderPage), bug tracker, and window.__bootApp (holds
                     the 5 load-order-sensitive blocks: showPage wrap,
                     toggleNotifPanel wrap, outside-click, Escape/swipe,
                     onAuthStateChanged).
/js/print-engine.js  shared print/PDF design system (foundational). Public
                     API window.printDocument(); internal _render* components;
                     PRINT_COLORS/FONTS/SIZES/LAYOUT constants. See "Print
                     design system" section below.
/js/auth.js          USER_DEFS, doLogin/doLogout, showSetup/showLogin,
                     runSetup, startApp, renderUsers, permission helpers.
/js/pos.js           loadData/loadBundles, PO create/registry/detail,
                     stage work (cutting/bundling/QC), generatePOPdf.
/js/embellishments.js Ammar's track: recipes, Observer Tower, embellishment
                     jobs, color library, QC reports, billing,
                     loadPrintingData, renderDashboard.
/js/hrm.js           Afnan's track: HRM seed/load, attendance, employees,
                     payroll, advances, loans, policy, HRM notifications.
/js/store.js         store items/transactions/log/templates, fabric
                     inventory, REST helpers, store notifications.
/js/store-accounts.js Store Accounts (Sept 2026, replaces js/store-cash.js):
                     purchasing with rates → inventory, vendor accounts
                     (terms, FIFO aging, statement, rate card, Excel),
                     metered consumables (water/gas daily log → generated
                     bill), runner floats, Cash + MCB, month close, owner
                     review. Pages `acct-*`, one renderPage line. Loaded
                     right after store.js. See "Store Accounts" below and
                     ACCOUNTS_PLAN.md.
/js/warehouse-sales.js Accounts level 2 (Sept 2026): Umair's customer
                     purchases, each copied from its ERP bill with the bill
                     (photo or PDF) attached. A third SECTION on the
                     fulfillment page, not a page id. Firestore `wh_sales`,
                     id = the ERP order number. Loaded right after
                     fulfillment.js. See "Store Accounts — level 2".
/js/gatepass.js      gate passes, returns, fabric-in, GP edit/approval,
                     generateGPPdf, generateJobSheetPDF.
/js/fulfillment.js   Daily Performance track: per-day dispatch & returns
                     entry + analytics + date-wise Log (loadFulfillmentData,
                     renderFulfillmentPage). Firestore `fulfillment_reports`,
                     one doc per day (id = YYYY-MM-DD). Owners/managers +
                     the scoped `fulfillment` role (Umair). Per-day PDF via
                     the print engine `daily-performance` variant
                     (window.fulfillPdf). The PostEx tab's CPR list dates a
                     receipt by its OWN date (30 Sept 2026, Master Accounts
                     M2 — see "The PostEx enrichment").
/js/profile.js       Profile — one page per signed-in person (photo, chosen
                     display name, job title, department, about) plus a team
                     directory. Firestore `user_profiles/{uid}`. Reached from
                     the topbar avatar, not the nav. NOTHING SENSITIVE lives
                     here — see "Profiles" below. Loaded after boards.js.
/js/diagnostics.js   never-a-blank-screen safety net: records every uncaught
                     error, watches for a stalled render, and shows an
                     on-screen panel with a cache-reset button. Loaded FIRST,
                     before shared.js. See "Diagnostics" below.
/js/env.js           which Firebase the page talks to: live, or (localhost only,
                     ?env=emulator) the local emulator on a demo- project. Loaded
                     second, right after diagnostics.js. See QA_ACCESS.md.
/tools/              qa-snapshot.js (live -> emulator, read-only source, masked,
                     secrets skipped), qa-probe.js (prove what the QA account can
                     and cannot do), qa-snapshot-lib.js (the pure half, tested in CI).
/js/activity.js      activity log loader.
/js/marketing.js     The Sales Team ▸ Marketing (Sept 2026, replaces the
                     Content Tracker 2026 sheet). M1: Creator Database +
                     scoring engine. Loaded LAST, after activity.js. Owners +
                     the creator_content_ops_lead role. See "The Sales Team
                     ▸ Marketing" below.
/js/notes.js         Creative Hub / Notes — Phase 1 of the Notion+Milanote
                     module (see "Creative Hub / Notes module" below). Hub
                     landing page (shared infra, also renders Mood Boards'
                     tile) + block-based pages, TEAM or PRIVATE.
                     Shared/cross-track, like pos.js/gatepass.js.
/js/boards.js        Mood Boards — Phase 2 of the Notion+Milanote module,
                     reached through the Creative Hub grid in js/notes.js.
                     Freeform canvas: image/text/link/file/to-do/frame/
                     sub-board cards, connector lines, pan/zoom, find +
                     minimap, nesting + templates, TEAM or PRIVATE. Page
                     `boards` is HOME — itself a board, Milanote-style;
                     `boards-all` is the flat list (templates, trash,
                     search). Loaded after notes.js. Shared/cross-track.
/js/ma-core.js       Master Accounts' pure core (M1, Sept 2026): charts,
                     documents, validation, postings, balances, calendar,
                     PDF data; M2 (30 Sept) added the couriers' receipts,
                     statements, collections, claims and disputes. No DOM,
                     no Firestore; node-requireable. Loaded after
                     theboard.js, before master-accounts.js.
/js/master-accounts.js Master Accounts' pages (ma-*), Afnan and Ammar
                     only (M2 added Money in ▸ Couriers, `ma-in`). Loaded
                     LAST. See "Master Accounts" and "Master Accounts — M2".
/netlify/lib/ma-server.js  shared server code for ma-attach / ma-share /
                     ma-backup and the rollup (bundled, not an endpoint).
/netlify/functions/ma-rollup-background.js  Master Accounts' nightly courier
                     rollup (M2, `45 3 * * *` UTC): PostEx parcels → `ma_cpr`
                     documents. Decides nothing — every figure comes from
                     js/ma-core.js; writes `ma_cpr`, `ma_runs/rollup` and one
                     `ma_audit` row. Admin SDK.
/netlify/functions/ma-rollup-now-background.js  the owners' "run it now" for
                     it (ID token → `verifyOwner` → 202; the page polls
                     `ma_runs/rollup`).
/netlify/lib/postex-core.js  shared PostEx logic (bundled into
                     postex-sync-background, postex-payments-background and
                     postex-status, not an endpoint): the parcel sync into
                     `postex_orders` and `enrichPayments`, which since M2
                     (30 Sept 2026) asks a parcel until it is FINISHED — see
                     "Master Accounts — M2 built", "The PostEx enrichment".
```

Load order is fixed in `index.html`:
`diagnostics → shared → print-engine → auth → pos → embellishments → hrm →
store → store-accounts → gatepass → fabric → production → shopify →
fulfillment → warehouse-sales → notes → boards → profile → activity →
marketing → patterns → theboard → ma-core → master-accounts`, then the
bootstrap module (read from `index.html`, 29 Sept 2026 — this list had gone
stale, missing nine files). All
`/js/*.js` are **plain global classic
scripts — no `import`/`export`**. They share one global lexical scope, so
top-level `let/const` are visible across files (declared exactly once);
top-level `function`/`var` also become `window.*`. Firebase is the ONLY ES
module, isolated to the bootstrap in `index.html`; everything else uses the
`window`-bridged `db`, `auth`, `rtdb`, `setDoc`, `doc`, `collection`,
`query`, `where`, `orderBy`, `getDocs`, `updateDoc`, … globals.

Anything that ran at module load time and depended on cross-file order or
Firebase (the 5 hoisted blocks) lives in `window.__bootApp()` in
`shared.js`, invoked by the module **after** the Firebase→window bridge and
**after** all classic scripts have parsed.

## Stack

- Frontend: vanilla JS (classic global scripts) — see File architecture above
- Auth: Firebase Auth (project `groovy-gatepass`)
- DB: Cloud Firestore + Realtime Database (RTDB used only for attendance)
- Images: Cloudinary, unsigned preset `groovy-ops`
- PDF: jsPDF · Excel: SheetJS · Barcodes: JsBarcode · QR: qrcode-generator
  — all **vendored** in `/assets/vendor`, not CDN-loaded (see below)
- Hosting: Netlify (auto-deploy on push to `main`)
- PWA: `manifest.json` + `sw.js` (installable, offline shell) — see below

## PWA / offline caching

The app is an installable PWA. No build step, no framework — just
`manifest.json`, `sw.js`, and a registration snippet in each HTML page.

### Bump `CACHE_VERSION` on every deploy that changes HTML/CSS/JS

`sw.js` serves precached HTML/CSS/JS **cache-first**, so phones keep
serving the old files until the cache version changes. Edit the constant at
the top of `sw.js`:

```js
const CACHE_VERSION = 'v1';   // → 'v2', 'v3', … on each shipped change
```

Bumping it makes the new service worker delete every `groovy-ops-*` cache
from the previous version on `activate`, then re-precache. **Forget this
and your change silently will not reach anyone who already opened the app.**
It costs nothing to bump it unnecessarily, so bump it when unsure.

**Cross-track collision — this has already happened once (Sept 2026).** Both
tracks work from the same `main`, so both can bump to the *same* number for
*different* content. Afnan's vendoring branch and Ammar's PO-notes branch
each shipped a `v33`; whoever's service worker installed first would have
left the other track's files uncached under a version that claimed to be
current. **On merging, if both sides touched `CACHE_VERSION`, bump again
past both** — the merge is new bytes and needs its own version.
`tests/check-cache-version.js` catches it (it compares the merge against the
previous `main` tip and sees changed files with an unchanged version), which
is how this one was caught.

**Third collision, Sept 2026 — the EASY shape, recorded for contrast.**
Afnan's rail/Trash work sat at `v68` while Ammar's Marketing M1 shipped
`v69`. Because the two values DIFFERED, git raised a real conflict in
`sw.js` and the merge could not complete without someone looking at it —
resolved to **`v70`**, past both, since the merge is new bytes. That is the
benign case. The dangerous one is directly below, where both sides pick the
same number and git has nothing to resolve.

**It happened again in Sept 2026, and the second time is worth recording
because of HOW it hid.** Afnan's table-QA fix and Ammar's cutting-registry
work both bumped to **`v61`**. The merge produced **no conflict at all** —
both sides had written the *identical* line, so git had nothing to resolve —
while the two `v61` builds were entirely different bytes. A clean merge is
therefore NOT evidence that the version is safe. **Read `CACHE_VERSION` on
both sides before merging, not just the conflict list**, and bump past both
(v61 + v61 → v62).

**Third time, 16 Sept 2026, and CI caught it before merge:** Marketing M2
bumped to `v69` while Afnan's Store REST-read fix (`61affaa`) landed on
`main` at `v69` too. Merging `main` into the M2 branch was clean again; the
PR's `check-cache-version` run is what failed ("still v69"). Bumped to
`v70` — and within minutes Afnan's Boards rail change landed at `v70`
too, so it went round again to `v71` — which Afnan's Store read-quota fix
had also just taken, so M2 finally merged at **`v72`**. Three collisions in
one PR, all clean merges. M3 then collided once more (Afnan's Store dashboard fix at `v73`) and
merged at **`v74`**. While both tracks ship several times an hour, expect
this on every PR: fetch, merge, bump past both, re-run, merge promptly. **Before opening a PR, and again
before merging it, `git fetch` and compare against the CURRENT
`origin/main`**, not the commit the branch started from.

### Update banner (Sept 2026) — content updates, NOT the home-screen icon

`_swWatchForUpdate(registration)` / `_showUpdateBanner()` (`js/shared.js`),
wired from `index.html`'s registration call — `index.html` only, the main
app; `color-backfill.html`/`pantone-importer.html` don't load `shared.js`
and keep silent-update-on-next-visit. Since `sw.js` always calls
`self.skipWaiting()`, a new SW takes control of every open tab on its own —
but the HTML/JS already loaded into memory doesn't retroactively change
until the page reloads. Without this, someone with the tab open all day
sits on stale code with zero indication a new version even shipped.
Detects a genuine update (not first install — checks
`navigator.serviceWorker.controller` already exists) and shows a
persistent bottom bar with an explicit **Refresh now** button. Never an
automatic reload — that could wipe an in-progress form.

**This does not, and cannot, force an already-installed home-screen/
desktop icon to refresh.** Once a PWA is installed, that icon is a
WebAPK-or-equivalent OS-level artifact (Android mints an actual APK;
Windows/Mac create their own shortcut record) — entirely outside any web
page's control. The browser checks periodically and may silently re-mint
it in the background over some unpredictable timeframe. The only
guaranteed-immediate fix for someone stuck on an old icon (e.g. everyone
who installed before the Sept 2026 real-logo swap) is to **uninstall and
reinstall** the app — that forces a fresh manifest fetch and icon capture.
There is no code fix for this; don't imply there is one.

### Adding a new `/js/*.js` file

Three places, or it breaks offline:

1. a `<script src>` tag in `index.html` (existing load order applies)
2. the `PRECACHE_URLS` array in `sw.js`
3. bump `CACHE_VERSION`

### How the fetch handler routes

- **Cache-first** — same-origin `/`, `*.html`, `/css/*`, `/js/*`,
  `/assets/*`, `/manifest.json`. Matched with `ignoreSearch: true`, so the
  `?v=…` cache-busting query strings in `index.html` do not need to stay in
  sync with `sw.js`.
- **Network-first** (falls back to cache) — everything else. This used to
  include the jsPDF / SheetJS / JsBarcode CDN scripts, which is exactly why
  PDF and Excel export silently failed offline; they are vendored now and
  precached like any other asset.
- **Never intercepted** — Firebase and Cloudinary's API host, matched by
  hostname in `BYPASS_HOSTS` (`firestore.googleapis.com`, `firebaseio.com`,
  `firebaseapp.com`, `googleapis.com` — so every `*.googleapis.com` —
  `google.com`, `gstatic.com`, `api.cloudinary.com`) and passed straight to
  the network. **Do not add a Firebase or `api.cloudinary.com` URL to any
  cache** — stale auth tokens and half-cached writes are the result. Only a
  GET is ever intercepted, with ONE exception handled before that check: a
  POST to `/share-target` (the phone's Share menu, see "Mood Boards — phone
  share") is answered by `handleShare()`, which parks the shared files and
  text in the `groovy-share-inbox` cache — deliberately not named
  `groovy-ops-*`, which the activate handler deletes on every deploy — and
  303s to `/index.html#share=<id>`.
- **Cache-first, images** — a `res.cloudinary.com` delivery URL
  (`isCloudinaryAsset`) is served by `cacheFirstImage()` from
  `groovy-ops-images` (`IMAGE_CACHE`), **deliberately NOT version-scoped**:
  a delivery URL is immutable, so photos survive deploys. Trimmed to 300
  entries, oldest first; an opaque response is never stored. (This bullet
  used to say Cloudinary was never intercepted — stale since the Mood
  Boards "Making it feel instant" round.)
- **Never cached: a private Cloudinary file — a Master Accounts bill,
  receipt or shared PDF** (M1.5b, `4057303`). `isPrivateCloudinary(url)` in
  `sw.js` is true when the URL's path has a segment that is exactly
  `authenticated`, `private` or `ma`; such a `res.cloudinary.com` request is
  not intercepted at all (the fetch listener returns before `respondWith`),
  and `cacheFirstImage()` checks again and plain-`fetch`es one that reaches
  it. **Why:** `IMAGE_CACHE` survives deploys, so the books' files put there
  would stay on the device for good. The `ma` segment is what catches the
  public fallback: every Master Accounts file is named `ma/<64 hex>` by the
  `ma-attach` function, and in that mode the long random address is the
  file's only lock. A private file is normally fetched through a 5-minute
  signed link on `api.cloudinary.com` (`…/<resource type>/download?…`), which
  `BYPASS_HOSTS` already covers — this check is for the `res.cloudinary.com`
  addresses. The match is by path segment, so it applies to ANY
  `res.cloudinary.com` URL carrying such a segment, whoever uploaded it.
  Not covered, and not needing to be: the share link itself
  (`/.netlify/functions/ma-share?t=…`, same-origin, network-first) — a
  navigation is fetched with `redirect:'manual'`, so its 302 comes back as
  an opaque redirect that is not `ok`, and its 404/410/503 pages are not
  `ok` either, so `networkFirst()` stores none of them (read from the code,
  as the security review did; not run in a browser). Download the books is
  a blob and never touches the network.

### Firestore offline persistence

Every `getFirestore(app)` call site (`index.html`, `color-backfill.html`,
`pantone-importer.html`) now uses `initializeFirestore(app, { localCache:
persistentLocalCache({ tabManager: persistentMultipleTabManager() }) })`,
wrapped in a `try/catch` that falls back to plain `getFirestore(app)` if
persistence can't start (private browsing, IndexedDB unavailable). Reads
are served from IndexedDB when offline; writes queue and sync on reconnect.

### Netlify

`netlify.toml` sets `Cache-Control: must-revalidate` on `/sw.js` so a stale
copy can't mask a version bump.

`NODE_VERSION` and `SECRETS_SCAN_SMART_DETECTION_ENABLED` now live in a
global `[build.environment]`, **not `[context.production.environment]`**.
Scoped to production, deploy previews inherited neither, and PR preview
builds failed while `main` deployed fine — most likely secret-scanning
tripping on the public Firebase web API key that `index.html` has to ship
in the clear. Moving them global fixed it. Keep them global, or PR
previews break again.

### Icons

`/assets/icons/icon-{192,512}.png` + `icon-maskable-v3-512.png` are the real
GROOVY wing/"G" mark (Sept 2026 — replaced the black/white "GO" placeholder).
Source: a 1920×1080 RGBA PNG the user supplied, transparent background,
mark itself ~880×484 after cropping to its alpha bounding box. Regenerated
with Pillow (`Image.alpha_composite`, `LANCZOS` resize) rather than by hand:
- `icon-192.png` / `icon-512.png` (`purpose: "any"`) — mark centered on a
  **transparent** canvas at 80% fill (by its longer dimension).
- **27 Sept, later: `icon-maskable-v3-512.png` — the logo on WARM WHITE
  (#FAF7F4), Afnan's pick "B" of three mock-ups** (white-on-gradient,
  gradient-on-white, graphite) after he called the black tile hideous. Same
  69.3% safe-circle fill. The same art at 180px is now the iPhone
  `apple-touch-icon` (`apple-touch-icon-180.png`, opaque — iOS fills
  transparency with black, which is the look he rejected). Precached.
  `manifest.json` `background_color` (the splash) is still black — not
  the icon, and the login is dark by default.
- **27 Sept: `icon-maskable-v2-512.png` replaced `icon-maskable-512.png`** (superseded by v3 above).
  Afnan asked for a transparent Android icon; that is not available to a
  web app (the launcher masks every icon to a shape and Chrome fills a
  non-maskable one onto a WHITE plate), so he chose "the mark fills the
  tile": 69.3% fill, the largest a 1.83:1 mark can take while its bounding
  box's corners stay inside Android's guaranteed 80% safe circle (2px
  margin; half-diagonal 202.3 ≤ 204.8). Built from `icon-512.png` cropped to
  its alpha bbox. A NEW filename, so Chrome's WebAPK update check sees a
  changed icon; an installed icon may still need uninstall/reinstall.
- (was) `icon-maskable-512.png` (`purpose: "maskable"`) — mark centered on an
  **opaque black** canvas (matches `manifest.json`'s `theme_color`/
  `background_color`, both `#000000`) at a conservative **60%** fill, so it
  stays inside Android's ~66%-diameter safe-zone circle after masking.

To regenerate from a new source file: crop to `img.split()[3].getbbox()`
(the alpha channel's bounding box) before scaling — do not skip this, the
source file had ~800px of transparent padding on every side that would
otherwise throw off every fill-ratio calculation above.

## Vendored libraries (Sept 2026)

jsPDF, SheetJS and JsBarcode live in **`/assets/vendor`** and are served from
this origin. They used to load from `cdnjs.cloudflare.com` and
`cdn.jsdelivr.net`, which cost three things:

1. **The PWA was not actually offline-capable.** `sw.js` routes cross-origin
   scripts network-first, so with no signal a gate-pass PDF or a payroll
   Excel export simply failed. They are in `PRECACHE_URLS` now.
2. **A third-party origin could change or vanish** under a business that
   prints gate passes and payroll from these files.
3. ~~**Neither CDN is reachable from this sandbox**, so no session could boot
   the app in a browser to check anything.~~ `tests/smoke-browser.js` can now.
   *(SUPERSEDED 29 Sept 2026: `cdnjs.cloudflare.com` and `cdn.jsdelivr.net`
   both answered from a session, and a headless Chrome in a session has since
   signed in to the live app and rendered the Board page — see "Sandbox limits".
   Reason 3 no longer holds; reasons 1 and 2 stand.)*

- **Fetched from `registry.npmjs.org`, not a CDN mirror**, and every
  tarball's sha512 was checked against the registry's own `dist.integrity`
  before extraction. The exact commands and the verified hashes are in
  `assets/vendor/README.md` — redo it from there, don't improvise.
- **The version is in the filename** (`jspdf-2.5.1.umd.min.js`), so the bytes
  at a URL never change: `netlify.toml` serves `/assets/vendor/*` with
  `immutable`, and they carry no `?v=` query string. **An upgrade is a new
  file plus a changed `<script src>`, never an edit in place.** Add the new
  path to `PRECACHE_URLS`, drop the old one, bump `CACHE_VERSION`.
- Each library ships its licence beside it (`*.LICENSE`) — jsPDF MIT,
  SheetJS Apache-2.0, JsBarcode MIT. `tests/invariants.test.js` fails if one
  is missing, if a vendored file is not referenced by `index.html`, or if any
  HTML file grows a `<script src>` pointing at a CDN again.
- Each tag carries an **`onerror` CDN fallback**. Reaching it means offline
  export is already broken for that visit, so it logs loudly; it exists so a
  bad deploy degrades instead of removing the feature outright. A CDN URL
  inside `onerror` is allowed by the invariant test; a CDN `src` is not.

## Print design system

Foundational shared engine for ALL print/PDF output. **Every future print
output (Production Order, Embroidery Vendor Sheet, Sublimation Vendor Sheet,
Gate Pass, QC Report, Placement Sheet, …) MUST route through this engine —
do not call jsPDF directly for new print features.**

- **Location:** `/js/print-engine.js` — plain global classic script, loaded
  in `index.html` AFTER `shared.js` and BEFORE `auth.js` / all domain files.
- **Fonts:** self-hosted in `/assets/fonts/` — Aptos (regular/bold/italic/
  bold-italic), Aptos Display (regular/bold), Jameel Noori Nastaleeq
  (regular/bold). `@font-face` (screen, `font-display:swap`) lives at the top
  of `css/main.css`; the engine embeds the same TTFs into PDFs via
  `addFileToVFS()` + `addFont()`. **7 of 8 fonts are real:** all four Aptos
  weights (`BoldItalic` = bold), `AptosDisplay-Regular` (= Aptos SemiBold),
  `AptosDisplay-Bold` (= Aptos Black) and `JameelNooriNastaleeq-Regular`
  (~10 MB) are real; only `JameelNooriNastaleeq-Bold` is still a placeholder
  stub (bold-Urdu source unavailable). Validation is per-file, so the engine
  embeds all real fonts and falls back to Helvetica only for that one stub
  (nothing breaks); screen uses the CSS fallback stack. See
  `/assets/fonts/FONT_INSTALL.md`. **Urdu is NOT DRAWN in any PDF — this
  line said "drawn unshaped" until 29 Sept 2026 (found 28 Sept), and that
  was wrong.**
  jsPDF 2.5.1's arabic plugin runs on every `text()` call (it subscribes to
  `preProcessText`) and rewrites each Arabic-script letter into a Unicode
  PRESENTATION FORM (U+FB50–FDFF, U+FE70–FEFF). The committed Jameel Noori
  Nastaleeq Regular maps **0** code points in U+FE70–FEFF and **4** in
  U+FB50–FDFF (U+FD3E, U+FD3F, U+FDF2, U+FDFA — two ornate brackets and two
  ligatures, no letter). A code point the font lacks becomes glyph 0
  (jsPDF's `characterToGlyph` returns `codeMap[c] || 0`), and JNN's glyph 0
  has an EMPTY outline (0 bytes in `glyf`, advance 1024 of 2048 units). So
  every Urdu letter is laid out and printed as blank space: "گیٹ پاس" goes
  out as six code points, none of them in the font. Of the 484 non-space
  code points in the engine's 51 Urdu string literals after that rewrite,
  the 44 that reach a real glyph are all Latin letters and punctuation
  (dashes, underscores, brackets) — no Arabic-script letter. What jsPDF
  leaves alone does draw: Urdu digits (U+06F0–06F9), the Urdu full stop
  (U+06D4) and, in a wider sample, one letter it has no form for (U+06C3).
  **Verified** by reading the committed TTF's `cmap`, `loca` and `glyf` and
  calling the vendored jsPDF's `processArabic` from node (reproducible from
  a session; re-run 29 Sept). A real gate pass rendered through pdf.js in
  headless Chromium showed the blank slots (**reported** from the M1.4
  session, not re-run). **Not seen on a device or a printer.**
  What a `full` document still costs: JNN is fetched (~10 MB) and embedded
  as a subset — the same PO measured ~552 KB at `full` against ~116 KB at
  `minimal` — for text nobody can see. Master Accounts' `ma-receipt` and
  `ma-voucher` ask the font first (`_prMaUrduOk`: every Urdu string they
  may draw, after `processArabic`, must map to a real glyph) and print
  clean English when it cannot; a font that carries the forms turns them
  bilingual with no code change. **The gate pass, the PO and every other
  `full` variant do not ask, and print the gaps.** A task to fix their Urdu
  was queued in that session (reported; its state is not in the repo).
  Screen text (`@font-face`, the browser's own shaping) is unaffected.
- **Public API (only global):**
  `window.printDocument({ type, data, filename })` where `type` ∈
  `po | embroidery-vendor | sublimation-vendor | gate-pass |
  placement-sheet | qc-report | payslip | daily-performance |
  stock-transfer | mood-board | generic`. **Implemented variants**
  (verified from the `_VARIANTS` registry in `printDocument`,
  `js/print-engine.js` — this list was stale here before, said only
  `gate-pass` shipped): ✅ `po` (`_renderPO`), ✅ `gate-pass`
  (`_renderGatePass`, single-page transit document laid out in English and
  Urdu — its Urdu half prints as blank space today, see **Fonts**), ✅
  `payslip` (`_renderPayslip`), ✅ `daily-performance`
  (`_renderDailyPerformance`), ✅ `stock-transfer`
  (`_renderStockTransfer`), ✅ **`pattern-label`** (Sept 2026 — the Pattern
  Hub's 5 × 6 in sticker, one page per label, on a **custom page size**
  `data.page={w,h}`; see "Pattern Hub" M4), and ✅ **`mood-board`** (Sept 2026 — the board
  as one picture fitted to the page plus a text index of every card
  carrying text; `_renderMoodBoard`). The mood-board picture is rasterised
  by the CALLER (`js/boards.js` draws the board onto a 2D canvas and
  passes a JPEG data URL) so the variant stays synchronous like every
  other one and the engine never learns how a board is drawn. ✅
  **`consumable-log`** (23 Sept 2026 — a metered vendor's daily log for
  one month plus its billing; `_renderConsumableLog`, `urduLevel`
  `minimal`; see "Store Accounts"). ✅ **Master Accounts** (M1.4, 28 Sept
  2026 — every figure is built by `js/ma-core.js`'s `maPdf*Data`; the engine
  formats and draws, and computes none): `ma-ledger` (one account for a
  range, **A4 landscape**, its table head redrawn on every page),
  `ma-statement-party` and `ma-statement-holder` (A4 portrait), and
  `ma-receipt` (a transfer's handover slip) and `ma-voucher` (a Money-out
  payment voucher), both **A5 (420×595)** drawing their own layout and
  footer like `pattern-label`, with VOID and "Revised · rev N" stamps. The
  two slips are `full`, but draw Urdu only when the embedded font has the
  glyphs jsPDF actually emits (`_prMaUrduOk`); JNN was measured with none of
  those presentation forms, so today they print clean English. Still not
  built: `embroidery-vendor`, `sublimation-vendor`, `placement-sheet`,
  `qc-report` — any of those (or an unknown type) logs a `console.warn`
  and renders the generic fallback (header + optional hero title +
  `data.bodyHtml` as text + bilingual footer). Opens the PDF in a new tab
  AND triggers download. The pre-opened tab shows a `_previewLoading`
  interim page (never a stark `about:blank`) during the font fetch/subset,
  and `_previewError` renders a readable failure page instead of a
  blank/closed tab. Remaining variant builders reuse the components below.
- **Landscape (M1.4):** `data.orientation:'landscape'` (or the type's default
  in `_PRINT_ORIENTATION_DEFAULTS`) builds A4 landscape (842×595) for a type
  in `_PRINT_LANDSCAPE_READY`; the shared components read the page from
  `_pageBox(doc)`. Every other variant stays A4 portrait, drawn exactly as
  before, and says so in a `console.warn`.
- **Blob delivery (M1.4):** `printDocument({…, deliver:'blob'})` opens no
  tab, downloads nothing and shows no toast; it resolves `{blob, filename}`,
  and a failure rejects. Without `deliver`, nothing changes.
- **`_renderPO` — Notes (Sept 2026):** free-text field on the PO, entered in
  `renderPOCreate()` (`js/pos.js`, `#po-notes` textarea) and saved as
  `po.notes`. Rendered on the printed PO traveler right after the order-info
  grid/product photo, before the station tables — always in
  `PRINT_COLORS.red` (`#DC2626`), never the default body text color, so it
  stands out to every station handling the PO. Also shown in red on the PO
  detail page (`renderDetailPage()`) and in the legacy (`__usePrintEngine =
  false`) jsPDF fallback in `generatePOPdf()`, so all three paths agree.
- **`_renderPO` layout (2 Oct 2026):** at most TWO A4 pages and a station block
  is never split — every part is a measured block, `_PO_DENSITIES` is tried
  comfortable → compact and the first whose simulated page flow fits two pages
  is drawn. START DATE (po.startDate; a red line when empty) is top-middle in
  the header, every station carries red START / END DATE lines, every table has
  a boxed TOTAL row, all table lines are red and double width. Station titles
  and the name printed under each live in `_PO_STATIONS`. No Urdu is drawn on
  the PO (the font draws blanks), so `po` defaults to `minimal`. A note past six
  lines at 7pt is cut with a visible marker. `tests/po-print.test.js`; **not
  seen on a printer.**
- **Internal components (NOT global; JSDoc'd in the file):**
  `_renderHeader`, `_renderFooter` (auto every page via `_stampFooters`),
  `_renderSectionHeader`, `_renderBilingualLabel`, `_renderInfoTable`,
  `_renderSignatureRow`, `_renderDivider`, `_renderTitleBlock`. They read
  `doc.__groovyFonts` (font resolver), `doc.__groovyDocType` (footer label)
  and maintain `doc.__groovyY` (running content cursor).
- **Constants:** `PRINT_COLORS`, `PRINT_FONTS`, `PRINT_SIZES`,
  `PRINT_LAYOUT` (A4 portrait in points: 595×842, 36pt margins,
  523pt content width) — declared at the top of `print-engine.js`.
- **Conditional Urdu embedding (`data.urduLevel`):** per-document flag
  `'none' | 'minimal' | 'full'` controlling whether the ~10 MB Jameel Noori
  Nastaleeq TTF is fetched + embedded. `'full'` fetches and embeds JNN —
  its Urdu letters are not drawn today (see **Fonts** above);
  `'minimal'`/`'none'` never download or
  embed JNN — the footer is English-only (`GROOVY · {documentType} ·
  Internal Use Only · Confidential`) and every bilingual component
  (`_renderFooter`, `_renderSectionHeader`, `_renderBilingualLabel`,
  `_renderInfoTable`, `_renderSignatureRow`) silently drops its Urdu side
  (no tofu). Explicit `data.urduLevel` wins; otherwise the per-type default
  in `_PRINT_URDU_DEFAULTS` applies; an unknown type/level → `'minimal'`.
  `gate-pass` is **forced to `'full'`** regardless of caller input (the
  variant is inherently bilingual for gate guards/vendors). The footer Urdu
  tail is type-aware via `_footerUr(documentType)` /
  `_PRINT_FOOTER_UR_BY_TYPE` (Gate Pass → `گیٹ پاس — صرف اندرونی استعمال`,
  Production Order → `پروڈکشن آرڈر …`, else generic `صرف اندرونی استعمال`).
  Resolution sets `doc.__groovyUrdu` (the `_urduOn(doc)` flag components
  read) — a `'full'` request with JNN unavailable degrades to clean
  English-only, never tofu; WITH JNN available the Urdu side prints as blank
  space, not tofu (see **Fonts**). Font fetch is split (`_fontCacheCore` always,
  `_fontCacheUrdu` lazily only on the first `'full'`). Per-render the engine
  serializes the PDF once and logs `[print-engine] Generated {type} PDF —
  urduLevel: {level}, size: ~{X}KB`.

  | Default `urduLevel` | Types |
  |---|---|
  | `none` | `pattern-label`, `ma-ledger`, `ma-statement-holder` |
  | `minimal` | `po` (2 Oct 2026), `generic`, `payroll-sheet`, `payslip`, `daily-performance`, `stock-transfer`, `mood-board`, `consumable-log`, `ma-statement-party` |
  | `full` | `gate-pass` (forced), `embroidery-vendor`, `sublimation-vendor`, `qc-report`, `placement-sheet`, `ma-receipt`, `ma-voucher` |

  Measured (same PO, real JNN): `minimal` ≈ 116 KB / 0 JNN fetch · `full`
  ≈ 552 KB / JNN fetched. jsPDF 2.5.1 subsets embedded TTFs so `full` is far
  below the raw 10 MB font; the main saving from `minimal` is skipping the
  ~10 MB **fetch** + base64 + subsetting work entirely.
- **Default path (shipped):** `window.__usePrintEngine` now defaults to
  `true` — all 5 legacy generators (`generatePOPdf`, `generateGPPdf`,
  `generateJobSheetPDF`, `exportPayrollPDF`, `downloadPayslipPDF`)
  short-circuit through `printDocument` (generic) by default. The legacy
  jsPDF code paths are **preserved as fallback only**, intact below each
  guard in `pos.js` / `gatepass.js` / `hrm.js`. Escape hatch: set
  `window.__usePrintEngine = false` in the browser console (or pre-load) to
  restore the old generators if anything breaks in production.

## Domain map — who owns what

### Afnan / HRM track (Claude) — owns `js/hrm.js`

All HRM track code lives in `js/hrm.js` (was previously in `index.html`):

- Employees, paygrades, increment logs (`employees`, `increment_logs`,
  `hrm_policies/main`)
- Attendance (RTDB `attendance/{date}/{k40}` + `attendance/live/{k40}`)
- Payroll engine (`payroll_runs`, `payslips`)
- Advances + loans (`advance_requests`, `loans`)
- Policy engine + change log (`policy_change_log`)
- HRM notification system (`hrm_notifications`) — bell on every page
- Bug tracker (`bug_reports`) — floating FAB on every page
- Worker dashboard ("Me" page, my-work HRM widget)
- Mobile nav redesign (5-button + bottom-sheet "More" pattern)
- Icon system (`_icon` SVG helper) + semantic accent palette
- ZKTeco sync script in `attendance-sync/`

### Ammar Shah / Embellishments track (Claude) — owns `js/embellishments.js`

All embellishments track code lives in `js/embellishments.js` (was
previously in `index.html`):

- Recipe directory + create + detail (`article_recipes`)
- Placement form (template-based, audience-specific worker views)
- Color library (`color_library`) + Pantone swatches
- Embellishment jobs + observer tower (`printing_jobs`)
- QC reports + billing (`qc_reports`, `printing_billing`)
- `PRINTING_RATE_MASTER` constant (~190 article codes) for tier auto-detect
- Monotone refactor of `STAGES`, `PRIORITY_COLORS`, badges → `#111`/`#f0f0f0`
- Mobile UI overhaul (commit 89994a0) — initial 44px touch targets,
  expanded media queries

### Shared / Operational (older code, neither owner exclusively)

- POs (`pos`, `bundles`) — carry `patternId`/`patternCode`/`patternHook`
  since the Pattern Hub's M6; see "Pattern Hub".
- Gate passes (`gatepasses`, `returns`, `fabricin`)
- Store (`store_items`, `store_transactions`, `store_notifications`,
  `trim_templates`)
- Activity log (`activity`)
- Counters (`counters`)
- Users (`USER_DEFS` array — owners/managers/workers)

## Creative Hub / Notes module (Phase 1 of Notion + Milanote, Sept 2026)

Afnan asked for "a full-scale Notion + Milanote combination" inside Groovy
Ops — a company wiki/SOPs, personal notes for anyone, design/reference mood
boards, and project/task planning boards. Agreed approach: ship it in
phases rather than all at once, and build the freeform canvas (Phase 2) in
vanilla JS/SVG rather than take a dependency, consistent with this repo's
zero-new-deps policy.

**"Creative Hub" is the top-level nav entry (no icon — deliberate), not
"Notes".** It's a category directory — `renderCreativeHub()` + the
card-grid CSS (`.hub-grid`/`.hub-tile`) live in `js/notes.js`/`css/main.css`
even though Mood Boards itself is a separate file, since the hub is shared
infrastructure both categories render into. `_HUB_CATEGORIES` (in
`js/notes.js`) drives the grid: **Notes** and **Mood Boards** are `status:
'live'` tiles; **SOPs & Guidelines**, **Storage** and **Chat** are `status:
'soon'` — greyed, non-navigating, tapping one shows a short toast
(`window.onHubTileClick`) rather than doing nothing. This is deliberate:
the grid previews the full roadmap now rather than only showing what's
built. Each tile gets a subtle left-edge color accent from `--cat-*` in
`css/main.css` (`--cat-notes`, `--cat-boards`, `--cat-sops`, `--cat-storage`,
`--cat-chat`) — decorative only, distinct from the semantic accent palette,
still no icons/emoji anywhere in the hub. Page hierarchy: `creative-hub`
(hub) → `notes` (TEAM/PRIVATE sections) → `note-detail` (one page), and
separately `creative-hub` → `boards` (gallery) → `board-canvas` (one
board). Each level's back-button goes exactly one level up, never straight
to the hub from a leaf page.

Note: Afnan has already flagged the Notes UI itself (the list cards, the
block editor) as "too child-like, not professional" — a visual revamp is
expected next. Don't take the current styling as settled; it's the first
functional cut, not the intended final look.

**Phase 1 (shipped): `js/notes.js` — Notion-lite block pages.** Covers the
wiki/SOPs and personal-notes use cases. Every signed-in user can create a
page, either:
- **`shared`** — a **TEAM** page, readable by any signed-in user.
- **`personal`** — a **PRIVATE** page, visible only to its owner (by
  Firebase `uid`), not even to owners. Deliberately no owner override on
  *read* here — "private" means private. Owners keep *delete* power
  (matches the fabricin/loans pattern elsewhere in `firestore.rules`), in
  case something inappropriate needs removing.

  The `notes` category page renders these as **two always-visible
  segregated sections** — TEAM and PRIVATE, each with its own "+ New"
  button — not a tab switcher. `firestore.rules` field is still literally
  `'shared'`/`'personal'`; TEAM/PRIVATE is display-layer wording only
  (`_notesCardHTML`, the detail-page visibility badge) — don't rename the
  Firestore field to match, that would be a needless migration for a
  cosmetic label.

Firestore: one doc per page in `notes_pages`, blocks stored as a plain
array field on the doc itself (no subcollection — simplest thing that
works at this app's scale). Block types: `paragraph, h1, h2, bullet,
numbered, checklist, quote, divider, image`. Notion-style typing shortcuts
convert a block's type (`"# "`→H1, `"- "`/`"* "`→bullet, `"1. "`→numbered,
`"[] "`→checklist, `"> "`→quote, `"---"`→divider); each block also has an
explicit type `<select>` so the feature doesn't depend on remembering the
shortcuts. No slash-command popup menu yet — deferred, not core to the MVP.

`loadNotesData()` runs two single-field queries — `where('visibility','==','shared')`
and `where('ownerUid','==',session.uid)` — and merges client-side, rather
than one broad query. This is deliberate: each query maps exactly onto one
clause of the `firestore.rules` read condition below, so Firestore can prove
every possible result is readable and the query never gets rejected — the
well-known Firestore gotcha is that rules are not a query filter, so a
broader query whose safety depends on a field outside its `where` clause
fails outright rather than silently omitting unreadable docs. Same
"fetch once, filter client-side" spirit as Monitor's activity fetch.

Block bodies are `contenteditable` and are rendered into other users' browsers
verbatim for `shared` pages — a real stored-XSS surface, not a hypothetical
one. `_notesRenderBlocksHTML` therefore renders block *structure* only
(empty bodies); `_notesHydrateBlocks()` fills in the actual text afterward
via `textContent`, never by interpolating stored text into an HTML string.
Keep it this way — collapsing the two steps back into one template string
to "simplify" it would reopen that hole. Everything else interpolated into
list-view HTML (titles, owner names) goes through `_notesEsc()`.

Editing does **not** follow this app's usual full-innerHTML-rerender-per-
action pattern for every keystroke — `contenteditable` needs cursor-position
stability, so typing mutates `_notesEditBlocks[i].text` in place via the
`oninput` handler with no rerender; only structural edits (add/delete/
reorder/type-change a block) call `_notesRerenderBlocks()` (scoped to the
`#notes-blocks` container) followed by `_notesFocusBlock()` to restore the
caret. Autosave is debounced ~900ms after the last edit
(`_notesSaveDebounced`/`_notesSaveNow`), flushed immediately on navigating
back or on a discrete action (checkbox toggle, image upload, visibility
change, delete).

**Autosave opts out of the shared blocking "Saving…" overlay** (Sept 2026
fix — Afnan reported it popping up on every single card drag in Mood
Boards, which is exactly the frequent/ambient write this overlay was never
meant for). `js/shared.js`'s write-buffer already had one opt-out,
`_fabBusy`, so a slow write during a Fabric action doesn't double up with
Fabric's own overlay; that was generalised into `_gvSilentSaveCount` /
`window._gvSilentSaveStart()` / `window._gvSilentSaveStop()` — any module
wraps just its own frequent write calls with start/stop (never globally for
a whole page visit) to suppress the blocking overlay for those writes only.
Both `_notesSaveNow` and `_boardsSaveNow` (`js/boards.js`) use it, each
driving its own small ambient status text instead (`#note-save-status`,
`#board-save-status` — "Unsaved changes…" → "Saving…" → "Saved"/"Save
failed"). Deliberately **not** wrapped: `notesCreatePage`/`notesDeletePage`/
`notesToggleVisibility` and their board equivalents — those are one-off,
deliberate actions where the normal blocking feedback is still correct.
If a future module adds its own frequent autosave, use this same pair
rather than re-deriving another opt-out.

### Notes — the "/" menu and the block gutter (28 Sept 2026)

Afnan had called the block editor "too child-like, not professional". The
pattern reference was BlockNote (MPL-2.0, read-only, nothing copied); the
shape of the fix is its `/` menu and side menu, written from scratch here.

- **`/` at the START of a block opens the type list** (`_notesSlashMatch`,
  pure: `/` plus non-space characters is the whole rule, so "and/or" is
  text). Typing narrows it by label prefix, then alias (`todo` finds
  Checklist), then substring (`_notesSlashItems`, pure). Arrow keys move,
  Enter/Tab pick, Escape closes and leaves the typing. **A menu with nothing
  matching closes itself and Enter is an ordinary Enter.** It replaces the
  per-block type `<select>`.
- **Three modes, one menu:** `slash` (typed; the typed `/query` is cleared on
  choose), `insert` (the + button, on a fresh empty block) and `turn` (the ⋮
  menu's "Turn into…", which keeps the block's words and therefore hides
  Divider, which would throw them away).
- **The gutter replaces the always-there toolbar:** `+` adds a block below
  (reusing an empty paragraph rather than stacking one) and ⋮ opens
  Turn into / Move up / Move down / Duplicate / Delete, each offered only
  where it applies. **There is no drag-to-reorder yet** — the menu's Move is
  the route; do not describe the ⋮ as a drag handle.
- **Placeholders are a cue, not a label:** shown on the focused empty block,
  on a lone empty page (`.note-only`) and on headings. Before, every empty
  block carried one.
- **One popover** (`#notes-pop`, `_notesPopShow`) serves both menus, built
  with `createElement` + `textContent`. Its document listeners are registered
  once at load (`__notesPopWired`). `#notes-pop` sits at z-index 210.
- **The XSS boundary is unchanged:** block structure renders with empty
  bodies and `_notesHydrateBlocks` fills text with `textContent`. The data
  model, `firestore.rules` and stored blocks did not change — no migration.
- **On a phone the gutter moves to the right edge and stays visible** (no
  hover). Held by `max-width:600px`, the module's own breakpoint.
- `tests/notes.test.js` (65) drives the real handlers; verified by
  reverting the key routing, the clear-on-choose and the Divider rule.
  `smoke-layout` fragment `notes — the page, the / menu and the block menu`
  holds contrast and overflow (breaking the hint ink fails it by name).
  **It does NOT hold an overlay covering an editable body** — checked: an
  `::after` over every block passed.
- **Nobody has typed into it on a real screen** — the sandbox cannot sign
  in [29 Sept: a headless QA session can sign in and render — see "Sandbox limits"]. It was rendered and looked at in headless Chromium, both themes.

**Nav:** "Creative Hub" (plain text, no icon/emoji — deliberate, per
Afnan) is a `mainItems` entry in `buildNav()` pointing at page id
`creative-hub`, in the mobile "More" sheet for owner/manager
(`openMoreSheet`) and store (`openStoreSubSheet`/`openStoreMoreSheet`), and
(for workers/viewers, whose fixed 3-button mobile nav has no More button —
see `_renderMobNav`) a button on their own "Me" page (`renderMePage()`,
`js/hrm.js`). There is no dedicated icon for this module — the `notebook`
SVG that was briefly added to `_icon()` was removed again once the nav
entry became icon-less; don't re-add it without a reason.

**Staged rollout: ONE list, six routes (Sept 2026 — widened to Ammar).**
`_CREATIVE_HUB_USERS` + `_canSeeCreativeHub()` in **`js/shared.js`** is the
single audience for the whole module. Six routes call it: the four nav
pushes above, the "Me" page button in `js/hrm.js`, and the deep-link guard
in `js/boards.js`.

It used to be six copies of `if(session.u==='afnan')` — including one
written **inverted** in `boards.js`, which a naive grep for the `===` form
missed. That made widening the audience a six-site edit whose failure mode
is a **partial rollout**: one way in open, another shut, and nothing on
screen to say which. `js/shared.js` loads first and these are classic
scripts sharing one lexical scope, so `hrm.js` and `boards.js` reach the
helper by bare name; both **guard with `typeof` and fail CLOSED**, so a
`shared.js` that failed to parse hides the hub rather than opening the
side door.

**Audience: `afnan`, `ammar`, `sami`, `mustafa`, `abbas`, `daniyal`** — Afnan dogfooded
it alone while the module was being shaped and opened it to Ammar once the
Trash/rail round landed; Sami (CSR Team Lead) was added 17 Sept 2026 at
Ammar's request, **Mustafa on 18 Sept 2026** (Afnan: "give mustafa creative
hub and all its features"), **Abbas on 21 Sept 2026** and **Daniyal on 25
Sept 2026**. The helper is called from **eleven** routes: the six below,
the CSR Team Lead's own sidebar and phone "More" sheet, and the Marketing
lead's sidebar, phone "More" sheet (`openMktMoreSheet`) and `showPage`
scope.

**Daniyal took three edits, not one word, and that is the thing to know
about any role that rewrites page ids.** He is `creator_content_ops_lead`,
whose `showPage` scope sends every id that is not `mkt-*`, `tb-*`,
`shopify-intel` or a chrome page to the Creator Database — so with only his
name on the list, clicking Creative Hub would have silently landed him back
on Creators. The scope now lets through **`_CREATIVE_HUB_PAGES`** (all six
hub ids, in `js/shared.js` beside the list) **only when
`_canSeeCreativeHub()` is true** — by the list, never by the role.
`tests/marketing.test.js` drives it both ways: Daniyal reaches all six, and
the same role under another username is still sent home from every one.
His role also builds its own sidebar and phone More sheet, so each gained a
Creative Hub entry (last, after Inventory Intel). `tests/theboard.test.js`
used to hold `boards` as a page he is sent home from; it now asserts he
reaches it. No `firestore.rules` change — the gate is nav-only.

**Abbas is the first WORKER on the list, and that is the only thing about
him that is new.** He is `worker` (Washing/Rider), and a worker's phone nav
is a fixed 3-button bar with **no More sheet** — so three of the eight
routes cannot reach him and his phone route is the "Me" page button in
`js/hrm.js`, which is exactly why that button exists. Verified by DRIVING
rather than by reading the pushes: as Abbas the sidebar is
`my-work, gatepass, creative-hub`, the phone bar is `My Work / Gate Pass /
Me`, `renderMePage()` carries the button, and `showPage` sends him to all
six hub pages unredirected (it scopes only `fulfillment`,
`creator_content_ops_lead` and `csr_lead`). **Another worker — Asghar — is
still false**, the same proof Arfat gives for the manager role: the gate is
a list, not a role.

Mustafa took **one word** — the list is the only gate, which is the whole
point of the round that replaced six hardcoded usernames with it. He holds
`manager`, and `showPage` scopes only `fulfillment`, `creator_content_ops_lead`
and `csr_lead`, so nothing redirects him; **Mood Boards needs no separate
grant** (it is reached through the hub tile, and its deep link reads the same
helper), so "all its features" follows from the one edit. **Arfat shares that
`manager` role and gets nothing**, the Sept 2026 rule. Verified by DRIVING
`buildNav()` and `window.openMoreSheet()` as Mustafa in the harness rather
than by reading the pushes: both carry Creative Hub, and Arfat's gate is
still false.

`tests/csr-lead.test.js` had used Mustafa as its "nobody else is affected"
manager, which would now pass whether the gate were a list or role-wide —
exactly the shape that makes a role-wide grant look correct. It uses **Arfat**
for that assertion now, and asserts Mustafa passes beside it.
Still by USERNAME, not a role and not `isOwner()`, matching the
`isMustafa()`-style per-person grants elsewhere. **Ammar's own Claude
session should be told the hub is now visible to him.**

This is a **nav-only** gate — `firestore.rules` already lets any signed-in
user create and read pages, matching how this app handles staged rollouts
elsewhere (Shopify Intel is nav-gated to `isOwner()`, not blocked at the
rules layer). **To roll out to everyone: make `_canSeeCreativeHub()` return
true.** That is the whole change.

`tests/invariants.test.js` guards four things and **each was verified by
breaking it**: all six routes call the helper (drop one → fails at 5), no
route still hardcodes a username (a leftover `session.u==='afnan'` → fails),
the audience is exactly the list recorded above (so widening it shows up in
a diff review rather than slipping through — it is asserted by name, and is
what has to be edited alongside `js/shared.js` each time), and both cross-file
callers keep the `typeof` guard.

**Phase 2 (shipped): `js/boards.js` — Mood Boards, the Milanote half.**
Reached only through the Creative Hub grid (no separate top-level nav
entry) — page ids `boards` (gallery) and `board-canvas` (one board).
Identical TEAM/PRIVATE ownership model and `firestore.rules` pattern to
Notes (`mood_boards` collection, same `ownerUid`/`visibility` read split,
same two-single-field-query merge in `loadBoardsData()`). A board is a
freeform canvas: cards (`image`, `text`, `link`) with independent
x/y/w/h, connector lines between them, and its own pan (`panX`/`panY`)
and `zoom`, all persisted as plain fields on the board doc — no
subcollection, same reasoning as `notes_pages`.

- **Canvas mechanics (vanilla JS/SVG, no library, per the zero-new-deps
  policy):** `.board-world` holds a CSS `translate(panX,panY) scale(zoom)`
  transform; cards are positioned in that same world-coordinate space via
  `left`/`top` in px, and the connector `<svg>` (`#board-conn-layer`) is a
  *sibling inside* `.board-world`, not a separately-transformed overlay —
  so connector `<line>` endpoints are just each card's center in world
  coordinates, no manual pan/zoom math needed to draw them. The only place
  that math is needed is converting a raw pointer event to world
  coordinates (`_boardsScreenToWorld`, used while dragging out a new
  connector) and it's one function, reused everywhere.
- **Drag/resize avoid full rerenders** the same way Notes' block editor
  does — a card's `left`/`top`/`width`/`height` are written directly via
  `el.style` during a pointer-move, with `_boardsRerenderCanvasAndWire()`
  (a full rebuild) reserved for structural changes only (add/delete a
  card, toggle visibility). Dragging a card doesn't lose text-card focus
  or cause flicker for the same cursor-stability reason documented under
  Notes above.
- **Each card has a drag handle strip** (`.board-card-head`) separate from
  its content — dragging always starts from the header, never from the
  body. This avoids the click-vs-drag ambiguity a single draggable+
  editable element would create, and was a deliberate choice over Notion's
  "drag anywhere on the block" feel: image and link cards aren't
  contenteditable at all, so a header-only handle is the one pattern that
  works identically across all three card types.
- **Link cards were manual entry** — you typed the URL, title and
  description yourself. **That shipped as a preview in Sept 2026** with
  exactly the hardening this note demanded; see "Link previews" below.
  The manual form is still there for a card with no URL yet and behind
  "Edit link details".
- **Image cards use the same `uploadToCloudinary()` helper** (`js/shared.js`)
  Notes' image blocks use — real uploaded photos, not placeholders.
- Gallery cards (`_boardGalleryCardHTML`) show a **live scaled-down
  preview** built from the same `cards` array as the real board (position
  + color/image, non-interactively, `transform:scale()`), not a static
  screenshot — so it never goes stale relative to the board's actual
  content.
- The canvas view (`.board-canvas-wrap`) is a `position:fixed;inset:0`
  full-viewport takeover (**`z-index:120`** — see below) rather than living inside the
  normal `#sidebar`/`#main-content` shell — deliberate, a freeform
  pan/zoom canvas needs the room a squeezed content column can't give it.
  This is the first page in the app to do this; the "← Boards" back button
  is the only way out, so don't add a second full-takeover page without
  checking it doesn't strand someone.
  **The z-index is load-bearing and was wrong until Sept 2026.** It shipped
  at `40`, but `.topbar` is `position:sticky; z-index:100` (and
  `.cash-action-bar` is 115) — so the app header painted straight over the
  board's own top bar and every control in it (back, breadcrumbs, title,
  save status, undo/redo, Find, Comments, zoom/Fit/100%, Map, Snap and the
  whole ⋯ menu: share, exports, duplicate, template, sub-board, delete)
  was invisible and unclickable. Nothing looked broken — the canvas, the
  card bar and the minimap all rendered — so it read as "those features
  were never built". Found from a user screenshot, not from testing. Keep
  it above 115 and below 500 (`#bug-report-fab`) so the FAB, toasts and
  the 998+ overlays still surface over the canvas. Anything new that is
  `position:fixed` near the top of the app has to be checked against this.
- **`#bug-report-fab` is fixed at `bottom:20px;right:20px` with
  `z-index:500`**, i.e. above the canvas, so anything parked in that corner
  collides with it. The minimap sits at `bottom:76px` (`136px` on mobile,
  where the FAB moves to `bottom:80px`) for exactly that reason.
- **No separate staged-rollout gate on Mood Boards itself** — it's reached
  only through the Creative Hub tile, which is already `session.u==='afnan'`-
  gated, so gating it again would be redundant. If Notes and Mood Boards
  ever need to open to different audiences (the "independent per category"
  rollout model that was agreed on), give the hub tile itself a per-
  category visibility check in `_HUB_CATEGORIES`/`onHubTileClick`, not a
  second gate inside `js/boards.js`.

### Mood Boards — Stage 1 (Sept 2026)

Afnan shared screenshots of the team's real Milanote boards (Winter Drop
2027: 46 cards, 20 files, viewed at **19% zoom**, organised into labelled
clusters, full of PDF tech packs). A 6-stage roadmap came out of that;
Stage 1 shipped the foundations. The full staged plan lives in a tracking
artifact — ask Afnan for the "Mood Boards Roadmap" link rather than
re-deriving it.

- **Undo/redo is snapshot-based** (`_boardsPushUndo` /
  `_boardsStateSnapshot` / `_boardsApplySnapshot`), not a command/inverse
  pattern: a board is tens of cards, so a JSON clone is cheap and EVERY
  mutation becomes undoable without each one maintaining its own inverse.
  ~~Snapshots cover cards + connectors only~~ — **SUPERSEDED Sept 2026:
  they cover the Unsorted tray too**, because stashing moves data between
  the board and the tray and an undo covering one half produced the same
  card in both places; see "drag anything into Unsorted". Still **not**
  pan/zoom (undoing a
  deliberate pan is more surprising than useful) and **not** typing (the
  browser's own contenteditable undo already handles text inside a card,
  and `_boardsOnKeydown` deliberately does not intercept Ctrl+Z while
  focus is in an input/textarea/contenteditable). A drag or resize pushes
  **one** entry, lazily on the gesture's first `pointermove` — pushing on
  `pointerdown` would leave a no-op entry for every plain click and make
  Ctrl+Z look broken. History resets when a board is opened. **Any new
  mutating action must call `_boardsPushUndo()` before it mutates** — that
  is the whole contract.
- **Board delete is a soft delete** — `deletedAt`/`deletedByName` are set
  on the doc and `loadBoardsData()` splits results into `moodBoards`
  (live) and `_boardsTrash`, with a Trash section in the gallery offering
  Restore / Delete forever. The filter is client-side
  (`all.filter(b=>!b.deletedAt)`) **not** a `where('deletedAt','==',null)`
  query, because boards written before this shipped don't carry the field
  at all and would vanish from such a query. Cards deliberately have **no**
  trash of their own — Ctrl+Z covers them, and a second recovery system
  for a one-keystroke-recoverable action is not worth its complexity.
- **Uploads accept any file, not just images.** `_boardsUploadAny()` posts
  to Cloudinary's `/auto/upload` (shared.js's `uploadToCloudinary()` posts
  to `/image/upload`, which rejects PDFs). It is deliberately local to
  boards.js rather than a widening of the shared helper, since
  `js/shared.js` is a cross-track coordination file. A `file` card shows
  extension / name / size and links to the asset; `_boardsPdfThumbUrl()`
  attempts a page-1 PDF thumbnail through a Cloudinary delivery transform
  and is **best-effort by design** — the `<img>` carries an `onerror` that
  hides it, so an account that can't rasterise PDFs degrades to the plain
  file card rather than a broken image.
- **Transient card fields are `_`-prefixed and stripped before saving**
  (`_boardsCardsForSave`). `_uploading` is the current one: a debounced
  save firing mid-upload would otherwise persist `_uploading:true` and the
  card would reload stuck on "Uploading…" forever. Keep that convention
  for any future per-render flag.
- **Multi-file drops coalesce** — dropping 20 files starts 20 parallel
  uploads, so renders collapse into the next animation frame via
  `_boardsRenderSoon()` and saves ride the normal 900ms autosave debounce
  instead of firing 20 writes.
- **Placement**: `_boardsPlacementPoint()` puts a new card in the middle
  of the current viewport with a 6-step cascade offset. Before Stage 1
  every new card landed on one fixed computed spot, so adding several in a
  row silently stacked them. Double-clicking empty canvas places a note
  exactly where you clicked.
- **Zoom range is 10%–300%** (`_BOARDS_ZOOM_MIN`/`MAX`), widened from the
  original 40%–200% after the 19% screenshots, and zoom is anchored to the
  viewport centre rather than the world origin so zooming out doesn't
  throw the content off-screen. `boardsFitView()` fits all cards on screen.
- **Paste** handles images (always wins, even with a text card focused —
  pasting an image into contenteditable does nothing useful anyway), URLs
  (→ link card, title pre-filled with the hostname) and plain text (→ note
  card). Text pasted **while a card is focused is left entirely alone** —
  that's an ordinary text paste and hijacking it would be infuriating.

### Mood Boards — Stage 2 (Sept 2026)

Arranging tools. Selection became a Set (`_boardsSelection`) rather than
the single `_boardsSelectedCardId` Stage 1 had — that conversion was the
whole point of doing multi-select first, since bulk move/delete/duplicate,
z-order and lock are all the same code for one card or twelve.

- **Marquee was Shift+drag and plain drag panned — REVERSED in Sept 2026**
  at Afnan's request, to match Milanote. See "Drag to select" below for how
  the original worry (a canvas with no scrollbars strands anyone who cannot
  pan) was answered rather than ignored. A plain click on empty canvas that
  doesn't turn into a drag still clears the selection, either way round.
- **Clicking a card that's already part of a multi-selection keeps the
  group** (`_boardsSelectCard`'s early return) — that's what lets you grab
  twelve cards by one of them and drag the lot. Shift/Ctrl-click toggles a
  card in or out.
- **A card's header runs selection on `pointerdown` (via
  `boardsCardDragStart`) and the card wrapper runs it again on `click`.**
  `window.boardsSelectCard` therefore ignores clicks originating inside
  `.board-card-head` — without that guard a shift-click on a header
  toggles twice and cancels itself out. Found by tracing, not in testing;
  don't remove the guard.
- **Z-order is array order** — later in `_editCards` paints on top, since
  cards are absolutely-positioned siblings. "Bring to front" is a reorder
  of that array, so no new persisted field and no migration.
- **Snapping has two mutually exclusive modes.** Snap-to-grid (the `Snap`
  toolbar toggle, `_BOARDS_GRID` = 20 world px) rounds positions; with it
  off, cards align to *each other* — `_boardsAlignDelta` compares the
  dragged card's left/centre/right and top/middle/bottom against every
  other card's and snaps to the nearest within `_BOARDS_SNAP_PX`, drawing
  the guide it snapped to. That threshold is in **screen** px, divided by
  zoom at use, so the catch feels identical at 19% and at 200%. The two
  modes would fight, so grid wins outright when on; **Alt suspends
  snapping entirely** for fine placement. The snap preference is
  per-viewer (`localStorage`), not board data — it shouldn't travel to
  someone else's screen with the board.
- **Copy/cut/paste goes through the SYSTEM clipboard**, as tagged JSON
  (`_BOARDS_CLIP_PREFIX` + the cards). Keeping cards only in a module
  variable would have raised "which clipboard wins on Ctrl+V?" — writing
  to the real clipboard makes it the single source of truth, and a copy
  then survives across tabs, not just between boards in one session.
  `_boardsClipboard` remains as a fallback for browsers that refuse the
  `setData` call. The paste handler checks the prefix **before** its
  URL/plain-text cases.
- **Locked cards** (`c.locked`) can't be dragged, resized, connected or
  deleted, and lose their delete/resize/connect handles — but stay
  selectable, since that's how you unlock them. Bulk delete skips them and
  says how many it kept rather than silently dropping part of the action.
- **Keyboard** (all ignored while focus is in an input/textarea/
  contenteditable, where they belong to the browser): Ctrl+Z / Ctrl+Shift+Z
  / Ctrl+Y, Ctrl+D duplicate, Ctrl+A select all, Esc clear, Delete /
  Backspace delete selection. Ctrl+C/X/V deliberately fall through
  `_boardsOnKeydown` untouched so they reach the real clipboard events.

### Mood Boards — Stage 3 (Sept 2026)

Structure: frames, to-do cards, freeform arrows, colour tags.

- **Frames are a CARD TYPE (`type:'frame'`), not a separate array** — so
  they inherit selection, drag, resize, undo, lock, copy and delete for
  free. The only special-casing is `_boardsRenderOrder()` (frames paint
  first, so they sit behind their contents) and drag. That render order
  also quietly constrains "bring to front" on a frame, which is correct: a
  frame raised above its own cards would hide them.
- **Frame membership is GEOMETRIC, never stored.** `_boardsCardsInFrame()`
  returns whatever currently sits inside the frame, computed at grab time,
  using card *centre* in bounds so a card overhanging an edge still counts.
  The alternative — a `frameId` on every card — means maintaining
  membership on every drag, resize, delete, undo and paste, with orphan
  states to reconcile whenever any of that goes wrong. This has none of
  that bookkeeping, needs no migration, and matches what the user sees.
  Dragging a frame takes its contents; resizing deliberately does not move
  them.
- **A frame's body is `pointer-events:none`; only its header strip and
  resize grip are interactive.** Without that, the frame rectangle would
  swallow panning, marquee-select and clicks on the cards inside it. Still
  true of the title block it wears since Sept 2026 — see "the column,
  rebuilt", where the frame took the column's header, a card count derived
  from that same geometry, and a collapse that has to remember the height
  its membership is measured against.
- **"Columns" from the roadmap shipped as arrange-once actions instead**
  (`boardsStackSelection` / `boardsGridSelection`, plus
  `boardsFrameSelection`). **SUPERSEDED in Sept 2026 — `stack` builds a
  REAL container now**; see "Column is a real container" below for the
  model and for why membership had to live on the child rather than on the
  column. `grid` and `wrapframe` are unchanged. The reasoning recorded here
  at the time (that stored membership fights the membership-free frame
  model) still holds *for frames* — the two containers now answer "what is
  inside me" differently on purpose.
- **Connectors now cover two shapes in one array**: card-bound
  (`{from,to}`, endpoints follow the cards) and freeform
  (`{free:true,x1,y1,x2,y2}`, fixed in world space), either with
  `arrow:true`. Deletion is **by index** (`boardsDeleteConnectorAt`)
  because freeform lines have no card ids to identify them — the old
  from/to deleter was removed rather than left alongside.
- **Line mode** (`_boardsLineMode`, the `↗ Line` button) makes dragging
  empty canvas draw an arrow instead of panning. A mode rather than a
  modifier: it's a deliberate "now I'm annotating" action, and it leaves
  Shift free for marquee.
- **`_boardsCloneCards` deep-clones via JSON.** It used to copy key by
  key, which was fine until to-do cards arrived carrying an `items` array
  — a shallow copy left the duplicate sharing that array with the
  original, so ticking a box on one ticked it on both.
- To-do item text is hydrated with `textContent` after render, exactly
  like text cards and Notes' blocks — same stored-XSS boundary, same rule:
  never interpolate user text into the HTML string.

### Mood Boards — Stage 4 (Sept 2026)

Scale: nesting, search, gallery tools, minimap, templates. This is the
stage that makes forty boards usable rather than eight.

- **Nesting needs BOTH halves to agree.** A board is treated as nested
  only when the child doc carries `parentId` *and* the parent board still
  holds a `board`-type card pointing at it (`_boardsNestedIds`). Fail
  either test — the link card was deleted, the parent was trashed, the
  parent isn't readable by this viewer — and the child surfaces back in
  the gallery at root level. Nothing is written to reconcile that; it is
  derived on read from boards already in memory. The alternative (clearing
  `parentId` when a link card is deleted) puts a Firestore write inside an
  undoable action and leaves an unreachable document whenever any part of
  it fails. **There is no way to lose a board by deleting a card.**
  `_boardsAncestors` walks the chain with a visited-set guard — a cycle is
  only reachable by hand-editing Firestore, but an infinite loop in the
  topbar render would take the page down.
- **A sub-board is a card type** (`type:'board'`, holding `boardId`), so
  it inherits drag/resize/select/undo/lock/delete like frames do. Its
  title is read **live** from `moodBoards` at render time — renaming a
  child updates every card pointing at it — with the stored `boardTitle`
  only a fallback for a board this viewer can't read. Creating one writes
  two things (the child doc, then the link card), so the save is flushed
  immediately rather than left to the 900ms debounce.
- **Back climbs one level** (`boardsBack` → parent board, else the
  gallery), matching the Notes rule. Breadcrumbs render only on a nested
  board — on a root board the trail would just repeat the back button.
- **Duplicate remaps connectors and drops sub-board links.**
  `_boardsCloneCards` mints new card ids but doesn't report them, so
  `_boardsDuplicatePayload` builds the id map and rewrites card-bound
  connectors through it (freeform lines carry world coordinates and need
  no remapping). Board-link cards are deliberately **not** copied — the
  alternatives are a copy that shares the original's children or a
  recursive multi-document copy with its own half-failed states — and the
  user is told how many were skipped rather than it happening silently.
- **A template is an ordinary board with `isTemplate:true`** — still
  openable and editable, just listed in its own gallery section with a
  "Use template" button that is the duplicate above under a clearer name.
  No separate collection, no migration.
- **Search covers card text, not just titles**, and runs over every live
  board including nested ones — `loadBoardsData` already reads whole
  documents, so the card text is in memory and this costs nothing extra.
  `_boardsCardText` is the single definition of "what text is in this
  card", shared by the gallery search and the in-canvas Find bar so the
  two can never disagree. Gallery search uses the debounced-input +
  refocus-after-rerender pattern from `fabInvSetSearch`; the Find bar does
  **not** rerender at all — it toggles `.found`/`.found-current` classes
  on existing elements, and jumping between matches **pans without
  changing zoom** (someone searching at 19% is looking at the whole board
  on purpose). Ctrl+F is intercepted on the canvas: every card is in the
  DOM at once, so the native find would "scroll" to a card sitting off in
  world space where nobody can see it.
- **The minimap is derived, not a snapshot** — built from the same `cards`
  array each structural render, so it cannot go stale. The viewport
  rectangle is updated by `_boardsApplyTransform`, i.e. on every pan and
  zoom, for the cost of four style writes. Dragging on it pans. On/off is
  `localStorage`, per-viewer, like the snap preference.
- **The board "⋯" menu is always in the DOM and only its display is
  toggled.** A full `_boardsRenderCanvasAndWire()` to open a menu would
  rebuild every card and redraw every connector on a 46-card board just to
  show five buttons. Its outside-click closer is registered once at load,
  like the paste/keydown handlers — a listener added during render would
  pile up, since the canvas DOM is replaced each time.
- **Recently-opened lives in `localStorage`** (`groovy-boards-recent`),
  never on the doc: it is about this person on this device, and storing it
  on the board would mean a write on every open and everyone's history
  overwriting everyone else's. The strip hides itself below two entries —
  a shortcut list of one is noise.

### Mood Boards — Stage 5 (Sept 2026)

Getting a board out of the app: PNG, PDF, and deep links to one card.

- **One renderer feeds both exports.** `_boardsRenderExportCanvas()` draws
  the whole board onto a 2D canvas; the PNG *is* that canvas, and the PDF
  is that canvas as a JPEG placed on an A4 page by the print engine. Two
  renderers would drift apart the first time a card type changed.
- **The board is drawn by hand, not rasterised from the DOM.**
  html2canvas and friends are a dependency, and this module has held the
  zero-new-deps line since Stage 1. Hand-drawing also decouples the export
  from the viewport — it always covers the whole board at a capped
  resolution (`_BOARDS_EXPORT_MAX_PX`), whatever the screen was showing.
  Colours and the font stack are read off the live CSS
  (`_boardsCssVar` / `getComputedStyle`) rather than duplicated here, so a
  palette change can't leave the exporter behind.
- **CORS is the whole risk in a canvas export.** An `<img>` drawn onto a
  canvas taints it unless the host allows cross-origin reads, and a
  tainted canvas refuses `toBlob`/`toDataURL` outright — the export would
  fail entirely, not partially. Every image loads with
  `crossOrigin='anonymous'`; one that fails is drawn as an "image
  unavailable" placeholder and counted, so a single un-CORS-able picture
  costs that one card instead of the export. **Cloudinary's CORS headers
  could not be verified from the build sandbox** (~~it cannot reach
  `res.cloudinary.com` at all~~ *SUPERSEDED 29 Sept 2026: `res.cloudinary.com` answers from a
  session — `/` gave 404 from the origin, `server: Cloudinary`; the headers on a real picture
  URL were not fetched, so this stays unverified*) — if exports come back with grey boxes
  where photos should be, that is what to check first, not the drawing
  code.
- **PDF goes through `js/print-engine.js`**, per the standing rule that no
  new print feature calls jsPDF directly — a `mood-board` variant was
  added to the engine (`known`, `_PRINT_DOC_LABELS`,
  `_PRINT_URDU_DEFAULTS` → `minimal`, `_VARIANTS`, `_renderMoodBoard`).
  **Known trade-off:** the engine builds every document A4 *portrait*, so
  a wide board scales down hard. The card index below the picture is what
  keeps the PDF useful (and searchable) at that size; per-type landscape
  would mean changing the shared `new jsPDF(...)` call in `printDocument`
  and was deliberately not done for one variant.
- **Deep links are the app's first and only URL routing**, and they stay
  entirely inside `boards.js`: `#board=<id>[&card=<id>]`, consumed after
  `startApp` (a link opened cold, once auth has resolved) and on
  `hashchange` (a link pasted into an open tab). `startApp` is *wrapped*,
  the same wrap-the-global pattern `__bootApp` already uses for
  `showPage`, rather than editing `js/auth.js` or `js/shared.js` — both
  cross-track files. Nothing else in the app has to learn about URLs.
- **A card link zooms in if it has to.** Landing at 19% would show a
  speck, so `_boardsFocusCard` raises zoom to 80% when it is below 50%,
  centres the card, selects it and flashes it briefly.
- **The deep link is gated on `session.u==='afnan'` too** — it is
  navigation, and it must not be a side door into a module whose nav is
  still Afnan-only. That makes **six** checks to
  remove at rollout (four in `js/shared.js`, one in `js/hrm.js`, plus
  `_boardsConsumeDeepLink` in `js/boards.js` — **six**, and the last is
  written inverted as `session.u!=='afnan'`).

### Mood Boards — Stage 6 (Sept 2026): collaboration

The stage the roadmap flagged as an architecture change. Live sync,
presence, comments, per-board sharing, per-board activity.

**The one policy change: a TEAM board is now editable by anyone signed
in.** It used to be editable only by whoever created it (plus app
owners), which made live editing, presence and comments pointless —
there could never be a second editor. PRIVATE is unchanged (owner only),
plus anyone the board is explicitly shared with. DELETE stays
owner-only, so nobody can bin a team board. `_boardsCanEdit()` and
`firestore.rules` mirror each other exactly; change both or neither.

- **The `cards` array stays on the board document.** Moving to a
  per-card subcollection is the textbook answer and was rejected on
  purpose: it means rewriting load, save, undo, export and the gallery
  previews plus a migration, to solve a problem two people on one board
  do not have. What the array *did* need was a save that cannot eat
  someone else's work.
- **Saving is a `runTransaction` that merges against the SERVER's array**,
  not against whatever this tab holds. Cards this session changed are
  written; every card it did not touch keeps the server's version — so a
  colleague's move survives our save even if their update never reached
  us. Which cards we changed is **derived, not tracked**: `_boardsBase`
  holds a JSON snapshot of the cards as the server last had them and
  `_boardsLocalChanges()` diffs against it. No mutation site anywhere in
  the file has to remember to mark itself dirty — the one thing that
  would certainly rot.
- **Offline falls back to the old queued `updateDoc`.** Transactions need
  connectivity; this is an installed PWA on phones. Offline you get
  pre-Stage-6 behaviour (last-writer-wins) rather than a refusal to save.
- **A remote update never lands mid-gesture.** `onSnapshot` merges are
  parked while a pointer gesture is in flight or focus is inside a card,
  and applied the moment that stops (plus a 2s safety flush). Without
  that, a remote update yanks the card out from under the pointer or
  resets the caret mid-word. The gesture flag is set once at the document
  level rather than inside all six drag/resize/pan/marquee/line/minimap
  handlers — one of them would eventually be added without it.
- **Pan and zoom are never taken from a remote update.** They stay on the
  document so a board opens where it was left, but applying someone
  else's pan to your open canvas is motion sickness, not collaboration.
- **A save in flight is guarded on the board id it belongs to.** Leaving
  a board flushes its save and immediately opens the next one, so the
  write can resolve when `_editBoard` is already a different board;
  adopting that result as the new board's baseline would mark every one
  of its cards as locally edited and the next save would overwrite a
  colleague's concurrent change. Everything after the await checks
  `savingId`.
- **Presence is Firestore, not RTDB** (`mood_boards/{id}/presence/{uid}`,
  25s heartbeat). RTDB would have meant importing client write functions
  the app deliberately does not have and republishing
  `database.rules.json`, whose `".write": false` is a security property
  worth keeping. A crashed tab never deletes its row, so **staleness**
  decides presence (70s ≈ three missed beats), not the row existing.
  Heartbeats live in their own subcollection so they never touch the
  board document and never wake everyone's merge logic.
- **Sharing is by AUTH EMAIL, not uid** (`sharedWith: ['x@groovy.op']`).
  Rules can read `request.auth.token.email` directly, and nothing in this
  app maps a username to a Firebase uid without a directory it does not
  have. The client adds a third single-field query
  (`where('sharedWith','array-contains',myEmail)`), one per read clause,
  keeping the "provably safe, no composite index" discipline.
- **Sub-collection rules check the parent board with `get()`**, not a bare
  `signedIn()` — a PRIVATE board's comments, activity and presence are no
  more readable than the board itself. `get()` results are cached per rule
  evaluation and these collections are low-volume, so it is one extra
  document read per request.
- **The activity feed is append-only** (`allow update, delete: if false`),
  same principle as `fabric_movements`, and records discrete actions only
  — never a drag, which would be noise and a write per pointer-up.
- **Comment bodies are hydrated with `textContent`** after the structure
  renders, exactly like text cards, to-do items and Notes' blocks. Same
  stored-XSS boundary, same rule: never interpolate someone else's text
  into an HTML string.
- **`onSnapshot` had to be bridged onto `window` in `index.html`** (the
  cross-track file) — one name added to the Firestore import and the
  `Object.assign`. Everything else stays inside `js/boards.js`; leaving
  the canvas by any route tears the four listeners down through a
  `showPage` wrap, the same pattern `__bootApp` uses.
- **Collaboration cannot actually be exercised until the module is rolled
  out** past the Afnan-only nav gate — there is no second person who can
  reach a board. The code degrades cleanly either way: with no
  `onSnapshot` bridged (an old cached `index.html`, say) every listener is
  skipped and the board behaves exactly as it did in Stage 5.

### Mood Boards — Stage 7 (Sept 2026): the phone

Afnan tested on a phone and **the canvas did not move at all**. Verified
from code rather than guessed: there was no touch handling anywhere in the
project — no `touch-action`, no pinch handler, no gesture code of any kind.
The canvas runs entirely on pointer events, and without `touch-action:none`
the browser claims a touch for its own scroll/zoom before those events ever
form a usable stream. **Confirmed fixed on the real device.**

- **`touch-action:none` on `.board-stage`** hands every touch to our
  handlers. Scrollable descendants (`.board-text-body`, `.board-todo-body`,
  `.board-rail`) declare their own `touch-action`, which works because the
  spec's ancestor walk stops at the element that implements the gesture.
- **Pinch-zoom** is the debt `touch-action:none` incurs. Pointer tracking is
  **document-level and capture-phase** on purpose: once a gesture calls
  `setPointerCapture`, that pointer retargets to the capturing element but
  still propagates through `document`, so this sees every finger no matter
  which handler owns the first one. The single-pointer pan, card drag and
  resize all bail while `_boardsPinch` is live.
- **Zoom detents** (`_boardsPinchZoom`): a pinch that starts below 100%
  **stops dead at 100% with a buzz** — 100% is where a board is meant to be
  read and you should be able to land on it exactly. Lift and pinch again
  and the gesture is in **micro mode**: the same finger travel buys a third
  of the zoom (`_BOARDS_MICRO_GAIN` = 0.34), so 100–200% is placeable
  rather than something you shoot past, capped at `_BOARDS_ZOOM_TOUCH_MAX`
  (200%) with a second buzz. **Pinching back IN is never geared down.**
  `navigator.vibrate` is Android-only; iOS Safari has no Vibration API and
  silently does nothing, which is the right degradation — the detent still
  holds, you just don't feel it.
- **Rotation** (`_boardsOnViewportChange`) holds the centre of the viewport
  still. Crossing the phone breakpoint re-renders rather than nudging the
  transform, since the minimap and rail layout change with it.
- **Double-tap places a note** where you tapped. `dblclick` is not reliable
  once the browser's own double-tap gesture is gone, so taps are paired
  explicitly (300ms, 28px). Mouse and touch both route through
  `_boardsAddNoteAt`.
- **`100dvh`, not `inset:0`.** Reported after the first fix shipped: the
  page behind the canvas still scrolled, with a scrollbar down the side and
  the board's top bar sliding off. `inset:0` sizes to the **layout**
  viewport, which on Android counts the browser UI. `.board-canvas-wrap` is
  now `height:100dvh` (100vh fallback first) and `body`/`html` carry
  `.board-fullscreen` (`overflow:hidden`) while the canvas is open. The
  viewport meta carries `viewport-fit=cover` and
  `interactive-widget=resizes-content`. **Anything else that goes
  full-viewport in this app must do the same — `100vh` is a lie on a
  phone.**
- **The minimap is gone on phones, and so is the Map button** — not left as
  a toggle that does nothing. It was a smudge parked between the docked rail
  and the bug FAB. Milanote's phone view has no equivalent. Desktop is
  unchanged. `_boardsIsPhone()` (a `matchMedia('(max-width:560px)')` check)
  is the single place that decides.
- **Fit / 100% / Snap move into the ⋯ menu** at phone width — the top bar
  wrapped onto two rows and ate ~150px of a canvas that is the whole point
  of the page.
### Mood Boards — click/double-click, the delete ✕, and Unsorted (Sept 2026)

Three things Afnan asked for in one round. The first two were bugs.

- **One click selects and moves; a double click edits.** Card bodies used to
  be `contenteditable` permanently, so a single click dropped a caret in and
  a card could only be moved by its header strip. Now the markup ships
  `contenteditable="false"` and exactly ONE element is switched on at a time
  (`_boardsEditingEl`, `window.boardsBeginEdit`). That single-element rule is
  what keeps the rest simple: `_boardsIsEditableFocus()` and every keyboard
  shortcut work unchanged, and `boardsCardDragStart` has one thing to check
  before deciding a press is a grab rather than a text selection. The caret
  is placed from the double-click coordinates via `caretRangeFromPoint`, not
  at the start — anything else feels broken on a long note. **Escape is read
  BEFORE the editable-focus bail** in `_boardsOnKeydown`, or it would be
  handed to the browser and do nothing. Leaving by clicking elsewhere is one
  document-level capture listener registered at load (not per render, which
  would stack), excluding `.board-fmt` — the formatting bar already
  `preventDefault`s its own mousedown to hold the selection. **Every card
  body now drags** except `link`, which is three form fields. A brand-new
  note or to-do item opens straight into edit mode.
- **The delete ✕ never worked, on any card.** It sits inside a header whose
  `onpointerdown` starts a drag and calls `setPointerCapture`; once the
  header captures the pointer, the following `click` is retargeted to the
  header and the button's own `onclick` never runs. The card-name span and
  the comment badge already carried `onpointerdown="event.stopPropagation()"`
  for exactly this reason — the two delete buttons (card and frame) were
  simply missed. **Anything clickable inside a drag handle needs that
  guard.**
- **Unsorted tray** — Milanote's holding pen, per board. `b.unsorted`, a
  plain array on the board document like `cards`; no subcollection, no
  migration, and a board written before this has an empty tray. Open/closed
  is per VIEWER (`localStorage`), never board data — same rule as the
  minimap and snap. A tray item is never edited in place, only added,
  removed or turned into a card, which is what lets the array be saved
  whole (in `head`, beside title and pan/zoom) instead of merged item by
  item; the remote merge adopts the server's copy unless something local is
  still uploading. **Dragging out is pointer-based, not HTML5 drag** — the
  stage already reads a native drag as "files from the desktop" (see
  `_boardsInternalDrag`) and the canvas runs on pointer events throughout.
  Dropping files ON the tray collects them; dropping on the canvas still
  places them. **PASTE ALWAYS COLLECTS NOW (Sept 2026)** — this line used to
  say "only while the tray is OPEN"; see "Paste always collects" below for
  the reversal and for how the objection that rule protected is answered.
  "Move to Unsorted" on the card menu is the reverse
  of dragging one out. ~~frames and sub-board links are excluded (a frame
  has no content of its own, a board link belongs with its parent)~~ —
  **SUPERSEDED Sept 2026: a frame and a column both go now, carrying their
  contents, and a card can be DRAGGED onto the tray rather than only sent
  there from a menu**; only a board link is still refused, and the item
  carries the whole card rather than a summary that turned a to-do into an
  empty note. See "drag anything into Unsorted". Labels are
  hydrated with `textContent` like every other user string in this file.

### Mood Boards — a to-do item can be double-clicked (Sept 2026)

Afnan, with the item circled: double-clicking a to-do did nothing. **The
handler was there the whole time and had never once run** — the fifth
appearance of one bug.

The to-do body is a drag surface, `boardsCardDragStart` calls
`setPointerCapture`, and **a captured pointer RETARGETS the following
`click` and `dblclick` to the CAPTURING element**. A note and a heading
survive that because their `ondblclick` sits on the very element holding
the drag handler; an item's sits on a **descendant**, so the dblclick went
to the body and the item's own handler was never reached. Exactly the table
cell. The checkbox and the remove button in the same row already carried
`onpointerdown="event.stopPropagation()"`; the text was missed.

The cost was recorded as: ~~a to-do card drags by its header strip and the
padding around its rows, not by the item text, just as a table drags by its
chrome.~~ **THAT COST WAS THE NEXT BUG, and this whole section is
SUPERSEDED** — the header strip became an inert overlay two rounds later,
so "drags by its header strip" stopped being true and the guard below was
all that was left holding the card still. Afnan reported it as *"to do not
moving properly"*; see **"to do not moving properly", and the guard that
caused it** above. The guard is gone from the item text, and the capture
that made it necessary is deferred past the drag threshold instead.

~~`tests/invariants.test.js` generalises it: every tag carrying an
`ondblclick` must either BE the drag element or stop pointerdown itself.~~
**Also superseded** — that rule's premise was the eager capture. The
invariant now guards the mechanism (the capture must come after the
threshold), which is what makes all five occurrences impossible at once
rather than patching the sixth.

### Mood Boards — the panel counts are red (Sept 2026)

Afnan, from a screenshot with both circled: the "1" beside Boards should
read as a count, not as part of the label. All three counts paint
**`--count-accent`** now — the two panel tabs (`.board-tray-tabn`), the
collapsed rail (`.board-tray-reopen-n`) and the top bar's Boards button,
whose count was bare text and is the same span now.

**THE TOKEN DELIBERATELY DOES NOT INVERT FOR DARK MODE**, unlike every
other accent in `:root`, and that is the whole point. A tab and the Boards
button are transparent over `--surface` when idle and a **`var(--dark)`
chip when `.on`** — and `--dark` inverts. So the count sits on FOUR
backgrounds, and a colour that flips with the theme is wrong on half of
them. `--accent-urgent` was the obvious choice and is one of those.
Measured on all four:

| | light surface | light chip | dark surface | dark chip |
|---|---|---|---|---|
| `#DC2626` | 4.83 | 4.35 | 3.70 | 4.13 |
| `--accent-urgent` light `#7B1F2A` | 10.1 | **2.07** | **1.76** | 8.66 |
| `--accent-urgent` dark `#F2A0A8` | **2.03** | 10.4 | 8.83 | **1.73** |

Each `--accent-urgent` value is invisible on the chip in the theme it
belongs to. `#DC2626` is the app's existing literal red and the only one
that reads everywhere. **Do not "fix" this by adding a dark override.**

Verified in the browser, not on paper: putting `#7B1F2A` in fails
`smoke-layout` naming `board-tray-tabn` at **2.07** — the same number the
arithmetic gives.

**`tests/smoke-layout.js` gained "Home's top bar".** Neither existing
top-bar fragment is on Home, so the Boards button — the control in the
screenshot, and the only route to the panel — had never been measured or
hit-tested at all. Verified by breaking it. `tests/boards.test.js` holds
the markup half, since no logic suite can see a colour: both counts must
be a span carrying the class, so a future edit cannot quietly put the
number back as bare text and lose the red.

**The CACHE_VERSION collision, again, in its benign shape.** Ammar's track
had landed at `v114` while this sat at `v111`; the merge was clean and
`sw.js` came through from their side untouched. The merge is new bytes on
both sides, so it went to **`v115`** — checked against the CURRENT
`origin/main`, not the commit this started from, which is the half that
keeps getting missed.

### Mood Boards — Home drops Unsorted, and a board drags back off (Sept 2026)

Afnan, with the arrow drawn from the canvas to the panel: *"there is no need
for unsorted function in home, and there there should be a function to drag
and drop board in board tab as well and there should be a motion to it."*

**HOME HAS NO UNSORTED.** Home is the board OF boards: the panel there
manages boards, and a scratch shelf for pasted images beside it was a
second, unrelated thing wearing the same chrome. The tab strip went with it
— a header carrying one tab says nothing — so **`_boardsTrayTab`, its setter
and its `localStorage` key are DELETED**, and the `.board-tray-tab` CSS with
them, rather than left behind as a flag nothing reads. Off Home the Unsorted
tray is untouched.

- **The consequence that had to be answered, not shrugged off: paste
  COLLECTS**, and on Home there is now nowhere to collect into. So **on Home
  a paste PLACES** — what it did before the tray existed — through
  `_boardsPlaceText`, pulled out of the right-click paste so the two cannot
  drift apart.
- **Anything already collected into a Home tray would be stranded** — saved
  on the document, reachable from nowhere. Nothing is rewritten on open to
  tidy that up (a write on a read path is the discipline this module holds
  against); the panel **says so, once**, with a button that places them, and
  it is gone for good after.
- `_boardsHomeFirstRun` un-collapses the panel now instead of switching a
  tab, still by assigning the field rather than calling `_boardsSetHomePanel`
  — a first-run nudge, not a setting.

**DRAGGING A BOARD CARD ONTO THE PANEL TAKES IT OFF HOME.** It is the **same
action as the ✕** — `window.boardsDeleteCard`, which on Home already means
"take it off Home and leave the board alone" — not a second unlink path
beside it; two of those is how the trash entry, the toast and the sub-board
wording would eventually disagree. **Only a lone board card qualifies**
(`_boardsUnplaceDrag`): a mixed multi-selection dropped there would have to
decide what to do with the cards in it that are not boards, and "some of
that did something" is worse than not offering the gesture.

**The undo is the fiddly part.** The card drag pushes its own entry on the
first `pointermove` and `boardsDeleteCard` pushes another, so a naive
version leaves **two** — Ctrl+Z putting the card back where it was *dropped*
and needing a second press to undo the move. The drop restores the cards to
where the gesture started and **pops the drag's own snapshot** before
deleting, so there is exactly one entry and it restores the card exactly
where it was.

**Motion**, both driven by a class the JS already sets, so nothing animates
on a timer that could be left running:

- **`.board-tray.panel-drop`** while a board card is held over the panel —
  deliberately the same dashed outline `.board-stage.tray-target` uses for
  the other direction, so there is **one drop-target look both ways round**.
  It is also what teaches the gesture: nothing else on screen says the panel
  takes a drop.
- **`.board-panel-row.flash`** on the row whose board just arrived or left,
  so the thing that changed is findable in a list of forty. **One-shot:**
  `_boardsPanelFlash` is consumed by the render that paints it, the way
  `_boardsNextPlacement` is, so it cannot repeat. Placing flashes too.
- Both suppressed under `prefers-reduced-motion`.

**The new gesture is DRIVEN in the test, not grepped** —
`boardsCardDragStart`, a `pointermove` to make it a drag rather than a
click, then a `pointerup` over a panel given a real rect (the harness's
default has no `right`/`bottom`) — because the whole thing lives in that
handler's closure. Verified by breaking each half: neutering the hit test
fails "the card is gone from Home", dropping the undo pop fails "one undo
entry, not two" (got 2), dropping the origins restore fails "exactly where
it started" (got 940,360), and leaving the flash flag set fails both
one-shot assertions. **The six tests that encoded the old two-tab behaviour
were rewritten to the new one rather than deleted.**

### Mood Boards — a board card IS the board’s picture (Sept 2026)

Afnan: *"on home max zoom out is 40%, while the way the board looks visually
on home we need to change that, it should be visually powerful."* A specimen
canvas was published with four options (the type-scale precedent); **he
picked A, the cover tile.**

**Home’s zoom floor is 40%** (`_BOARDS_HOME_ZOOM_MIN`). Home holds board
cards and nothing else, and a board card is something you READ; an ordinary
board holds tech packs you legitimately want to see all of at once, which is
what 25% is for. `_boardsClampZoom` stays THE one enforcement point and now
reads `_boardsZoomFloor()`, **the only thing that touches
`_BOARDS_ZOOM_MIN`** — a test counts the references so nothing can read the
constant and skip the Home branch. It also puts Home entirely inside the
`mid` LOD band, so a board card there is never drawn in `far`.

- **A live bug the test found:** the board OPEN path clamped **inside the
  object literal it was building**, so `_editBoard` was still the PREVIOUS
  board when the floor was read and a Home saved below 40% came back at 25%.
  Clamped after the assignment now.
- **A test-only hazard, hit twice:** two `_pending` blocks that each set up
  state and then await overwrite each other (every body runs to its first
  await at push time) — **and so does synchronous code that touches
  `_editBoard` while one of them is mid-await.** Both opens are sequenced in
  one block; the synchronous clamp checks get their own `loadApp`.

**THE CARD.** It was 200×124 of grey chrome — type label, truncated title,
count, button, identical for every board — while the board already stored a
**cover picture**, a **colour** and an **icon or letter** that only the
Boards panel ever drew. The same board was read by picture on the right and
as grey text on the left. **That was the gap, not the size.** 240×180 now:
cover full bleed, or the colour carrying its glyph, name on a scrim.
**Nothing new is stored and nothing migrates.**

- **ONE decision about what a board looks like.** `_boardsFaceOf(b)` returns
  `{cover,color,glyph}` and the gallery tile, the panel row and the card all
  read it. Three copies of "cover, then icon, then first letter" would
  disagree the first time one learned something. `_boardsCountFiles` is the
  same tidy-up — it had two identical copies and this needed a third.
- **The header OVERLAYS the picture** rather than taking a row — a 28px grey
  strip above the cover is exactly the chrome this replaces. It stays in the
  DOM (drag handle, card name, delete ✕) as a transparent bar with a soft
  gradient. Only `.type-board` is touched.
- **THE SCRIM IS A SOLID FLOOR, NOT A FADE, AND THE PROBE SETTLED THAT.**
  The first cut was a gradient to transparent; `smoke-layout` reported white
  ink at **1:1** in light mode. Tempting to dismiss as a probe limitation —
  a gradient has no `backgroundColor` to read — but there was a real bug
  under it: **a board with no colour falls back to `var(--soft)`, `#EFEFEF`
  in light mode**, and a cover photograph can be just as light. The band
  carries an opaque `background-color` now, the gradient only deepens its
  foot, and the top edge is softened with a `box-shadow` instead of
  transparency. **A literal white ink is correct here because the scrim
  under it is literal too.**
- **Double-click opens the board**, with the handler on the very element
  carrying the drag handler — a descendant would be retargeted away by the
  pointer capture, the bug this file has now found five times. The Open pill
  stays rather than being removed.
- **Existing cards are NOT resized on open** — a write on a read path is
  what this module refuses. `_BOARDS_MIN_BODY_H.board` 78 → **124**, so the
  render grows an old 200×124 card to fit its own name, no migration.
- At `far` the whole scrim goes: the picture is what tells boards apart at
  that zoom, which is the entire reason the card became one.
- **The `smoke-layout` fragment swaps the covers for a solid WHITE image**,
  so a scrim that ever fades back to transparent reads as white-on-white.
  Verified both ways, as are the cover-URL guard and the `ondblclick`
  placement.

### Mood Boards — the Board tool drags, and the drop point survives (Sept 2026)

Afnan, with the Board tool circled in the rail and an arrow drawn onto the
canvas: *"drag and drop funtion for board from side task bar as well in home
+ in board as well"*.

**`add:board` was the one content tool without `drag:true`.** Every other
placing tool has had drag-to-place since M6. It places a card like the rest;
it just mints the board behind it first, and the drop point survives that
because `boardsAddChildBoard` consumes `_boardsPlacementPoint()` **before**
its first `await`. One flag covers both halves of the ask — `_boardsRailItems`
has no Home branch, so the rail is identical on Home and on a board, and on
Home the same action already means "a NEW board, not a sub-board".

**The three tools still click-only are the three that PLACE nothing**: `line`
is a mode, `imagepanel` and `file` open a picker. The comment above
`_BOARDS_RAIL_MAIN` used to claim every entry carried `drag:true`, which was
never true; it says which do not and why now.

**A LIVE BUG FOUND WHILE CHECKING, and it is the bigger half.**
`_boardsCtxWorld` is set when the right-click menu **opens** and is never
cleared when it closes, and `_boardsCtxRun`'s `place()` overwrites
`_boardsNextPlacement` from it. The rail's **click** path cleared it; the
**drag** path was missed. So after ONE right-click anywhere on the canvas,
**every rail drag landed its card at that stale point** instead of under the
pointer — live since M6, and invisible unless you happen to right-click
first. Measured before the fix: a drop at (300,300) landed at
**(-1089,-1039)**.

### Mood Boards — the bin fills up (Sept 2026)

Afnan, with the Trash circled: the number darkens as the count rises — white
through a gradient of phases to red — and at 30 the bin animates to ask to be
emptied, with an option inside it to ignore that for 24 hours.

- **FOUR DISCRETE PHASES, not a colour interpolated per count.** Each phase
  is a class, so `tests/smoke-layout.js` can render it and MEASURE its
  contrast in both themes; a per-count colour could only ever be
  spot-checked. `_boardsTrashPhase` is the single definition, so the badge,
  the panel and the tests cannot disagree about "nearly full". Bands are
  1–9 (the badge exactly as it was) / 10–19 / 20–29 / 30+.
- **THE INK INVERTS, and here that is right rather than a violation.** The
  badge chip is `var(--red)`, which inverts — near-black in light, near
  **white** in dark — so this ink has exactly ONE background and a fixed ramp
  would be correct in one theme and invisible in the other. That is the
  opposite of `--count-accent`'s case, which sits on four backgrounds and
  therefore must NOT invert. Measured against the chip it actually sits on:
  **15.11 / 9.75 / 6.55** in light, **7.28 / 5.47 / 4.92** in dark.
- **What that means for the ask as written:** "starts with white" is
  literally true in LIGHT mode, where the chip is black. In dark the chip is
  near-white, so the ramp starts near-black and runs to red — the same
  journey, inverted with the chip under it. A literal white start would be
  invisible at count 1 in dark, which is the failure this file keeps
  recording.
- **The shake is on the BUTTON, not the badge** — it is the bin that should
  catch the eye, and a 15px chip twitching alone reads as a rendering fault
  rather than a prompt. It runs off a class the paint sets, so nothing
  animates on a timer that could be left running, and it stops the moment
  the count drops (restoring a card is enough — `_boardsTrashLive` is
  derived, so nothing is written) or the snooze is taken.
- **The snooze is per VIEWER and per BOARD**, in `localStorage`, the rule the
  minimap, snap and the tray's open state already follow. It is about this
  person being nagged on this board, so it must never travel to someone
  else's screen, and one global snooze would silence a board you have not
  looked at. Expired entries are pruned on write, so the key cannot grow.
- **While snoozed the strip still SHOWS**, saying until when — hiding it
  would leave no way back. It states the **count** rather than "the trash is
  full", because 30 is a nudge and not a limit: nothing stops working at it,
  and a message implying otherwise would be a lie.

**`_boardsTrashAlarm` is extracted from the painting for the same reason
`_boardsPreviewBackdrop` was:** the node harness's `querySelector` returns
`null`, so `_boardsPaintTrashCount` bails there and no logic suite can reach
the decision through it. **The DOM toggle itself is held by neither suite** —
the colours are smoke-layout's, the boundaries and the snooze are
boards.test.js's — and both comments say so rather than implying coverage.

Verified both ways: moving the threshold to 25 fails four assertions by name,
dropping the snooze from the alarm fails "taking it silences the alarm",
dropping the prune fails with `old,b1`, and putting a near-chip colour into
the dark ramp fails the new fragment at **1.09:1** naming
`board-rail-badge fill-3`. **Nobody has seen the shake or the ramp on a real
screen** — the sandbox cannot sign in [29 Sept: a headless QA session can sign in and render — see "Sandbox limits"].

### Mood Boards — the rail, sized to Milanote's, and it colours on hover (Sept 2026)

Afnan, with our rail circled on a 1080p screen: *"study the left tool bar
its too small, hard to see animations and small texts … increase each
icon size by 30%"*, then with Milanote's beside it: *"study milanote the
size is perfect, look at the icons, the text size"*, and *"it uses colors
and animation when you hover on each icon"*.

**Milanote's numbers were READ OFF HIS SCREENSHOT, not visited** (the
sandbox cannot reach Milanote): a ~68px rail, ~24px icons, ~12px labels,
one tool every ~62px. Ours was 17px icons, 11px labels and a 48px pitch.
Now, on a tall enough screen: **92px rail, 74px buttons, 22px icons, 13px
labels, a 61px pitch** — the +30% he asked for, landing on Milanote's
pitch.

- **TWO TIERS BY VIEWPORT HEIGHT, and the threshold is measured.** The
  large rail's natural height is **808px** (twelve tools: Milanote has
  eleven, we carry Fit), and the rail check in `tests/smoke-layout.js`
  says Trash must never scroll off. The board canvas loses only its own
  **50px** top bar (measured — it is a fixed takeover, so the app bar is
  not above it), so the large tier applies at `min-height:880px` of
  viewport and a shorter screen keeps the compact rail. In practice:
  **1080p gets the large rail; a 1440×900 laptop (~790px of viewport) and
  a 768px laptop keep the compact one.** The compact rail's own natural
  height is 623px, unchanged. **Phones are excluded outright** — the tier
  is `(min-width:561px) and (min-height:…)` — because the phone dock's
  height is the number the whole bottom stack is built off.
- **THE HOVER TILE CHANGES NO LAYOUT.** Each tool's icon fills a coloured
  tile with a white glyph, lifts 1px and grows 6% on hover; the tile is
  the svg's own `padding:5px` cancelled by `margin:-5px`, so it paints
  into the button's padding and the pitch is what it was on both tiers.
  Colours are `--tool-*` tokens, one per tool, **declared once and never
  redefined for dark mode** — the ink on them is literal white, so the
  tile is literal too (the `--count-accent` rule). Every tile measured
  ≥ **3.19:1** under white (Note is the palest). The label keeps
  `var(--text)`. The drag cue still slides out beside the tile.
- **The colours and the motion are built from Afnan's description**, not
  copied — nothing here claims to match Milanote's palette or timing.
- **The slide-out cue was moved on both tiers to clear the tile — and then
  REPLACED the same day** by Milanote's actual cue, a "Drag me" tooltip;
  see the next section. The `::after` rules are gone.
- The trash badge grows with the tier (19px, 13px ink) and the shake's
  travel went up about 30% too (−14/12/−9/6/−4°) — the icon is bigger and
  so is the ask.

**Three things about verifying.**

- **The first cut did nothing.** The tier block was written at line ~1130,
  BEFORE the base `.rail-btn` rules at ~1280; a media query adds no
  specificity, so the later rules won and the measurement came back at
  17px/11px. Moved below the last rail rule. **A `@media` override of a
  rule declared later in the file is silently ignored** — the LOD rules
  learned the same lesson with `!important`.
- **`tests/smoke-layout.js` builders may now return `heights`** (extra
  window heights), and the rail fragment runs at 1000px AND 768px with a
  wrapper of `calc(100vh - 50px)`, i.e. the real stage — verified by
  lowering the tier to 600px, which fails all four 768px jobs at
  `scroll:807, client:631`. **It opts out of 420px:** a wrapper one
  viewport tall plus the probe's own `<pre>` overflows the page, the
  vertical scrollbar takes 15px off the phone dock, and the Image tool then
  sits 4px past its edge — reported as "covered" by the wrapper. Diagnosed
  by rebuilding the probe's exact markup in the fixture (the dock's right
  edge read 474 with the old 640px wrapper and 459 with the tall one), not
  by guessing. The dock is measured at real phone widths by `smoke-phone`.
- **`tests/invariants.test.js` guards the tiles**, and caught a dead
  selector on its first run: every `.rail-btn[data-act="…"]:hover` must
  name an act `js/boards.js` emits (the first cut wrote `comment`; the
  selection rail's is `card-comment`), no `--tool-*` may appear in the
  dark block, the tier must be scoped by width and height, and the tile
  must keep its padding/margin pair. Verified by breaking each.

**Nobody has seen the tiles, the colours or the larger rail on a real
screen** — the sandbox cannot sign in [29 Sept: a headless QA session can sign in and render — see "Sandbox limits"].

### Mood Boards — the Note round, from the video (Sept 2026)

Afnan sent a 115-second screen recording of Milanote (`f4c22d31-
compressed.mp4`, 620×944 at 30fps) — *"study animation and how functions
work from the side tool bar … we will first finish Notes and all animations
of side tool bar"* — and asked for the top bar's Home to improve too.
**Everything below was READ OFF THE FRAMES** (cv2, contact sheets per
second, then zoomed strips at 10–30fps and a per-frame box-track of the Note
tile), not remembered or inferred. The sandbox cannot open Milanote.

**What the video shows, per feature:**

- **Hover (6.0–7.5s):** the icon does NOT move — the tile's box stayed at
  x 26–47 across the whole hover; its brightness rose ~2.5% (200→205
  grey). About half a second in (6.5s, ~15 frames after entry) a dark
  bubble reading **"Drag me"** fades in (~3 frames) to the RIGHT of the
  tile, tail pointing left, centred on the icon; it goes on leave. **So the
  slide-out bar shipped one commit earlier was wrong and is deleted** —
  `.board-rail-tip` (`_boardsRailTipArm/Show/Hide`, 450ms delay, mouse
  only) is the cue now. It is `position:fixed`, placed by JS: `.board-rail`
  clips on the x axis and a `::after` would have been cut off.
  `tests/invariants.test.js` holds the scope (armed AND drawn only for
  `data-drag="1"`; no `.rail-btn ::after` may exist) — verified by dropping
  the re-check.
- **Drag (22.0–25.0s):** press on Note, and while still over the rail the
  cursor is the **not-allowed** sign; over the canvas a **full note card
  ghost** ("Start typing…", at the board's zoom) follows the pointer with
  its top-left under it; the drop lands the card selected, "Saving…", and
  straight into edit. Ours: a Note is carried as that card
  (`_boardsRailGhostShow`, `_BOARDS_NOTE_W/H` = 220×100 — named so the
  ghost and `_boardsNewCard` cannot drift; asserted), `body.cursor` is
  `not-allowed` off the canvas. **Other tools keep the chip**: their sizes
  live in `_boardsNewCard`, which is not pure, and this round was Notes.
- **The rail SWAPS (24.60→24.80s, ~3 frames)** from the add tools to a
  **text rail**: ← , Text style, B, I, S, U, bullets, numbers. That is the
  rail's **fifth mode** now (`_boardsFmtActive()`: a `board-txt-*` body
  holds the caret, desktop only) and it outranks the other four. Rendering
  gained `glyph` items (a bold B, an italic I — static markup from the item
  list, never user text) and two swatch rows (`fmtSwatches`, `fmtHilite`).
  The swap is a **140ms slide-in keyed on a MODE change**
  (`host.dataset.mode`), never on a plain repaint — a trash-count paint
  must not replay it. **The floating bar stays on the PHONE**, docked above
  the keyboard; on desktop `_boardsShowFmtBar` renders the rail instead.
- **Text style (29s):** Large heading · Normal heading · Normal text ✓ ·
  Small text · Code block · Callout · Quote block, then Color and Highlight
  rows. Ours opens the same list beside the rail button through the
  existing `_boardsOpenCtx` (`_BOARDS_FMT_BLOCKS` → `formatBlock`
  h2/h3/div/h6/pre/blockquote); colours and highlights sit in the rail.
  **Callout is deliberately not built** — it is a styled block with an
  icon, and the sanitiser's allow-list is tags, not classes. **Small text
  is `<h6>`**, styled small and muted: `formatBlock` takes block tags only,
  and the sanitiser keys on tags — an honest hack, recorded as one.
- **ONE implementation of every formatting action** (`_boardsFmtAct`):
  the phone's bar buttons and the rail's `fmt:*` acts both reach it
  through `_boardsCtxRun`. Asserted command by command (`styleWithCSS`
  off for bold, on for a colour or highlight; `formatBlock:<h2>`).
- **The sanitiser widened, and only by what the menu writes.** Every
  heading level folds onto h2/h3/h6 (pasted `<h1>` cannot smuggle a size
  the menu never offers), `pre` and `blockquote` survive, and a highlight
  survives ONLY when its colour is on `_BOARDS_HILITE_COLORS` — an
  allow-list of five, not a validated hex (the M1 cell-colour lesson):
  reverting that to "any `#RRGGBB`" fails four assertions. The browser
  writes `rgb(…)`, so that is normalised before the lookup.
- **Pressing a formatting tool must not end the edit or move the caret.**
  Three guards: the rail's `pointerdown` `preventDefault`s for `fmt:*`
  (the floating bar's rule), the Text style menu `preventDefault`s its
  `mousedown` while `_boardsFmtActive()`, and the document-level click-away
  that calls `_boardsEndEdit` ignores `[data-act^="fmt:"]`, `.rail-fmt-row`
  and `.board-ctx` while a note is being edited. **None of the three is
  held by a test** — the harness cannot drive focus — so they are the first
  thing to check if a rail button "does nothing" on a note.
- **Selected, not editing (34–41s):** Color (the tile shows the card's
  CURRENT colour), Labels, Reactions, Comment, ⋯ (Convert to Document, Lock
  Position, Bring to Front, Send to Back, "Created by you"). Ours already
  had this rail; **the current-colour tile, the Background/Top strip colour
  panel and Convert to Document are NOT done** — recorded as the next gaps.
- **The Home trail (every frame):** a round logo chip · **Home** · `/` ·
  the board's colour tile · its name, with Saved/Saving under it. Ours was a
  red "← Home" text link. It is `.board-home-chip` (the app's own
  `icon-192.png` — a red-orange mark on transparency, measured — on a
  `--soft` round, so no literal colour) · Home · `/` · ancestors ·
  `_boardsTileHTML(b,22)` · the title input. "All boards" is a crumb when
  that is where you came from. **Phone keeps the capped back button**; Home
  keeps "← Creative Hub" beside the chip. The three top-bar layout
  fragments hit-test and contrast the trail (164/164).

**Measured before shipping** (`scratchpad/measure-rail-text.js`): the text
rail is 580px in the compact tier and 654px in the large one, so it fits
where the add rail fits; every glyph button hit-tests; the glyph gets the
same hover tile as an svg. `tests/harness.js` gained property-boundary
matching in its style stub — `background-color:` used to read as `color:`,
which the sanitiser tests exposed on their first run.

**Nobody has seen the tip, the ghost, the text rail or the trail on a real
screen** — the sandbox cannot sign in [29 Sept: a headless QA session can sign in and render — see "Sandbox limits"].

### Mood Boards — Background, the Color tile, and Convert to Document (Sept 2026)

The three gaps the video round left, at Afnan's ask: *"now do the color
tile, top strip panel and convert to document."*

- **`c.color` was always the TOP STRIP** (the header band and border);
  **`c.bg` is the BACKGROUND**, new, painted by `.bg-<name>` beside
  `.tint-<name>`. Both are palette NAMES, never a stored hex — the table's
  cell-colour rule: a name maps to a token that inverts with the theme,
  where a literal is light-on-light in dark mode. **That is also why the
  panel has no "Custom colour…"** unlike a board's tile: a card body with
  text on it cannot take an arbitrary literal. Blue and purple had no soft
  token, so `--cat-notes-soft` / `--cat-boards-soft` exist now in both
  themes; the other three reuse the accent `*-soft` tokens. **Every
  background is MEASURED with real text in both themes** by the new
  `smoke-layout` fragment `boards — card backgrounds and the colour panel`.
- **The rail's Color button is a READOUT** (`_boardsColorTileClass`): the
  background when set, else the strip, else an empty dashed outline. A name
  off the palette paints nothing — verified by dropping the check. It
  replaced the inline swatch grid on the desktop selection rail; the phone's
  Colour sheet gained a Background row above the Top strip row.
- **The panel is Milanote's, and LIVE.** `Background | Top strip` tabs, the
  swatch grid marking the current pick, anchored beside the tile.
  `_boardsOpenCtx` learned `items` as a FUNCTION plus `{keep:true}`: an
  action re-renders the menu in place instead of closing it, so trying
  three colours is not three round trips (the board look sheet's reason).
  **The live re-render is not held by a test** — the harness cannot drive
  the menu's click listener — so if a pick closes the panel, that is the
  first thing to check.
- **Convert to Document = a Creative Hub NOTES PAGE.** Milanote's turns a
  note into a full document; ours is `js/notes.js`'s block page, so
  `boardsConvertToDocument` writes one (`notes_pages`, visibility from the
  board, title = the note's first line, one paragraph per blank-line
  gap, `fromBoardId` recorded) and turns the card into a **link card to
  it, in place**, at the same size. **Rich formatting is not carried** —
  the page has its own block model. **Ctrl+Z restores the CARD and the
  page stays**, and the confirm and the toast both say so: a document that
  vanished with an undo would be worse than one left behind. On the note's
  right-click menu (and so the phone's More sheet).
- **`#note=<id>` is a deep link now**, consumed by the same
  `_boardsConsumeDeepLink` as `#board=` (same Creative Hub gate) and handed
  to `window.notesOpenPage` behind a `typeof` guard. The link card's URL is
  the app's own origin plus that hash, so `_boardsSafeHref` (https only)
  passes it and the title opens the page in a new tab.

Verified both ways: an off-palette tile name, the note link left unparsed,
and the conversion leaving the note's text on the link card each fail by
name. **Nobody has seen the panel, the tile or a converted note on a real
screen** — the sandbox cannot sign in [29 Sept: a headless QA session can sign in and render — see "Sandbox limits"].

### Mood Boards — Labels, Reactions and Comments as Milanote's panels (Sept 2026)

Afnan: *"now do the labels, reactions and comment panel like milanote."*
Read off the same video (42–59s labels, 60–79s reactions, 80–99s
comments), frame strips at full resolution.

- **A sheet can be a POPOVER.** `_boardsOpenSheet(title,html,{anchor,
  width})` — `anchor` is a rail action (`{act:'labels'}`) or a rect (the
  card a thread belongs to). On desktop the same element floats beside the
  anchor with a tail, no dark backdrop (a clear one still catches the
  outside click), flipped to the left when the right has no room; on a
  phone the anchor is ignored and it is the bottom sheet it always was.
  **Fourteen callers pass no anchor and are unchanged.** The panels are
  written ONCE for both surfaces.
- **Labels** (`_boardsLabelRowsFor`, pure): one field at the top that both
  searches and creates; under it the board's list headed by the board's
  name, each row a checkbox and the chip, ticked when it is on the card;
  a term matching nothing exactly offers "+ Create label 'x'" (with the
  colour swatches under it); no rows says "There are no results". Enter on
  an existing name ticks it rather than minting a twin. The library stays
  DERIVED from the cards — nothing stored to make the list.
- **Reactions**: Milanote's categories on the left (Frequently used ·
  Smileys & Emotions · People & Body · Animals & Nature · Food & Drink ·
  Travel & Places · Activities · Objects · Symbols · Flags), the emoji on
  the right under headings in one scrolling pane, search at the foot. The
  catalogue (`_BOARDS_EMOJI_CATS`) is **curated, ~230 with a keyword
  each** — the zero-new-deps line; not the Unicode set and its name
  dataset. **"Frequently used" is derived** from the reactions already on
  this board's cards, falling back to `_BOARDS_REACTIONS`. **Skin tones
  are not built.** Picking keeps the panel open, marking the emoji, and
  the pane's scroll position survives the repaint.
- **Comments are a bubble beside the CARD** on desktop (`boardsOpenComments`
  → `_boardsRenderCommentPop`, anchored to the card's rect): avatar
  initials, "Write a comment…", Send; the thread as name · time · text ·
  Reply / Resolve / Delete; the count badge on the card as before. The side
  drawer stays for the whole-board view and for phones. **Replies exist
  now** (`replyTo` on the comment — the comments rule has no field
  allow-list, so **no rules change**), one level deep; `_boardsThread`
  orders parents by time with their replies under them and **keeps an
  orphaned reply as a parent** rather than dropping it. Incoming
  comments repaint the bubble and a draft in the box survives. **Opening
  the sheet closes the previous one, and closing forgets the reply
  target — so the render carries it across the reopen by hand** (the
  first cut lost every reply that way; the test caught it).
- **Avatar initials sit on `--cat-*`/`--accent-warning` tokens in
  `--on-dark` ink**, chosen by a hash of the name — measured in both themes
  by the new fragment `boards — labels, reactions and comment panels`,
  which renders all three panels flat (their panes scroll in the app, and
  a scrolled-away emoji reads as "covered" — the documented false hit) and
  stacked (side by side, one panel's rows sat under another's emoji).
- **Harness note:** `classList.add` does not update the stub's `className`;
  assert through `classList.contains`.

**Nobody has seen the three panels on a real screen** — the sandbox cannot
sign in [29 Sept: a headless QA session can sign in and render — see "Sandbox limits"].

### Mood Boards — the ⋯ menu and Lock position, like Milanote's (Sept 2026)

Afnan: *"now do the more menu and lock position like milanote."* Read off the
same video (99–107s and 112s): the selection rail is **Color · Labels ·
Reactions · Comment**, the type's own tools (Rename, Caption on an image),
then **⋯**; ⋯ opens a popover beside the button reading **Convert to
Document** (a note) · **Lock Position** · **Bring to Front** · **Send to
Back** · a footer with an avatar, **"Created by you just now"**. **Lock was
never actually applied in the video** — the menu still says "Lock Position"
when it is reopened at 106s — so what a locked card LOOKS like there is not
known from it; ours is built from the name.

- **THE ⋯ LIST IS DERIVED, NOT WRITTEN.** `_boardsMoreItems(canEdit)` is the
  right-click list (`_boardsCardCtxItems`) **minus whatever the rail beside
  it already carries** (read live from `_boardsRailItems()`) and minus the
  swatch rows, whose place is the Color tile. One definition of what a card
  can do now feeds the right-click menu, the desktop ⋯ popover and the
  phone's More sheet. The test holds the algebra rather than a list: nothing
  on the rail repeats in ⋯, nothing the right-click offers is lost between
  the two, and ⋯ offers nothing the right-click does not — so adding an
  action in one place puts it in all three, and moving one onto the rail
  drops it out of ⋯ on its own. Verified by dropping the rail filter (three
  assertions fail by name) and by dropping ⋯ from the rail (two).
- **The groups are Milanote's order:** the type's remaining actions (so
  Convert to Document leads for a note), then Lock, then z-order, then the
  multi-select arranging, then the clipboard block (Cut · Copy · Duplicate
  · Delete · Move to Unsorted · Copy link), then the footer.
- **Duplicate / Front / Back / Lock / Delete and the Column · Grid · Frame
  trio LEFT the desktop rail** — they were same-weight tools beside Color
  and Comment, and the rail read as a long list of everything rather than a
  short list of what you do often. Delete keeps its key, its right-click
  entry and the ⋯ entry; Trash at the foot of the add rail is still where a
  deleted card goes. The selection rail is 7 buttons now and fits every
  tier. `React` became `Reactions`, Milanote's label.
- **⋯ is on the rail whether or not you can edit** — Copy text, Copy link
  and the provenance footer are read-only actions, and a rail that ends in
  nothing for a viewer invites the click anyway.
- **Provenance is a `{who,mine,at}` item now, not a `title` string**, drawn
  by `_boardsCtxHTML` as `.board-ctx-who` — the comment bubble's avatar
  (`_boardsAvatarHTML`, initials on a `--cat-*` token) beside
  `_boardsWhoText` ("Created by you just now" / "Created by Ammar 1m ago").
  The right-click menu, ⋯ and the phone sheet all render it, so the same
  person looks the same everywhere. The colour-panel layout fragment
  measures it in both themes — verified by painting its ink `--surface`,
  which fails all four jobs.
- **Lock position.** Same `c.locked` semantics as before (selectable,
  editable, commentable; will not move or resize; loses its ✕ and grip),
  under Milanote's name — "Lock position" / "Unlock position" in ⋯ and the
  right-click menu. Two things changed because the lock now lives behind
  ⋯: **a padlock beside the card's name** (`.board-card-lock`, the locked
  head strip's own ink) replaced the ` · Locked` text, and **every refusal
  says where the unlock is** — `_boardsLockedMsg(verb)` is the one phrasing
  ("Position locked — unlock it from the ⋯ menu to move it"), replacing
  ten copies of "Card is locked — unlock it to …", and toggling it says so
  out loud too. The padlock is in the header, so the `far` level-of-detail
  band hides it with the rest of the chrome, on purpose.
- **The desktop ⋯ is the same `.board-ctx` the right-click opens**, placed
  at the button's right edge + 10px, top-aligned (`_boardsSheetAnchorRect`
  finds the button; `_boardsOpenCtx` clamps to the viewport). On a phone
  `boardsOpenMore` is still the bottom sheet.

**Nobody has seen the popover or the padlock on a real screen** — the
sandbox cannot sign in [29 Sept: a headless QA session can sign in and render — see "Sandbox limits"].

### Mood Boards — label chips and reactions ON the card, like Milanote's (Sept 2026)

Afnan: *"now do the labels chips and reactions on the card like milanote."*
Read off the video (56–59s, the note card tracked frame by frame): a label
is a **small rounded chip INSIDE the card, bottom-left, under the text**,
sentence case ("see this"), light green on the red note with dark green ink,
and the card **grew 6px** (82×17 → 82×23 at that zoom) to make room for it.
**No reaction was ever placed in the video** — the picker was opened and
closed (the card is 82×23 before and after) — so the reaction pill is built
from the label's shape, not copied.

- **Labels and reactions are the card's FOOT now** (`_boardsCardFootHTML`,
  `.board-card-foot`), rendered AFTER the body. They used to be an uppercase
  boxed row wedged between the header and the body, and a `--soft` pill row
  under it. A label is a 999px-radius chip, 13px (the card-text floor — it is
  multiplied by the board zoom), weight 600, sentence case, soft tint of its
  colour with the colour's own ink (`lc-green` = `--accent-success-soft` /
  `--accent-success`, the video's pairing); blue and purple use the
  `--cat-*-soft` tokens the colour panel already added, so every chip inverts
  with the theme. A reaction is the same pill with the emoji and its count.
  **Your own reaction is outlined in `--cat-notes`** rather than painted as a
  `--dark` chip — a near-black pill on a note read as a button, not a tally.
- **The class names did not change** (`.board-labels`, `.board-reactions`,
  `board-label-<id>-<i>` ids): the `far` level-of-detail rules, the layout
  probe's far-zoom contract and the hydrate all key on them. The foot itself
  is hidden at `far` too, or its padding would stay as an empty band.
- **`_BOARDS_CHROME_H.labels/.reactions` are 31, MEASURED** in headless
  Chromium (`scratchpad/measure-foot.js`): a 21px chip row inside a foot
  padded 3px above and 7px below. With both rows the foot's padding is
  counted twice — 7px of deliberate slack, since a WRAPPED row of labels
  still gets no extra height and a little air beats a clipped chip. Existing
  cards are not resized on open, as ever; the render grows them.
- **The layout fragment carries a note at h:0** wearing a label and two
  reactions, so the render draws it at exactly its minimum height. Verified
  by under-counting the foot (31 → 12): it fails at 420px naming the two
  reaction chips as covered and the sub-board card's meta line at `h:0`.
  **At 1280/1900 it does NOT fail** — there the note's BODY is what gets
  crushed, and a note whose last line is cut off is deliberately not a
  finding (see "the QA retest"). The sub-board card is the one that holds
  the constant at every width.
- The exporter draws neither labels nor reactions (checked, not assumed),
  so nothing there moved.

**Nobody has seen the chips on a real screen** — the sandbox cannot sign in [29 Sept: a headless QA session can sign in and render — see "Sandbox limits"].

### Mood Boards — NO CARD HAS A HEADER (Sept 2026, the second video)

Afnan sent a second 126-second Milanote recording (`12a361e8-
next_too_compressed.mp4`, 760×950 at 30fps, the "Winter Drop 2027" board)
and asked for all of it. **Everything below was READ OFF THE FRAMES** with
cv2 — per-second contact sheets, then full-resolution stills and a
frame-by-frame strip of each gesture — never remembered or inferred. The
sandbox cannot open Milanote.

**The headline: no card type in that video has a header strip.** Not the
link card, the to-do card, the image card or the file card. A Milanote card
is an optional coloured top strip, the content, and an optional caption.
There is no type label, no name row and no delete ✕ anywhere on it.

- **Ours keeps all four, one hover away.** `.board-card-head` is an
  absolutely positioned dark scrim on EVERY type now, hidden by
  **visibility** (not opacity alone — an opacity:0 strip still takes the
  pointer, and on a phone a tap on the corner would reach an invisible ✕).
  It is the photo card's treatment from a round earlier, generalised. At
  rest a card is pure content the way Milanote's is.
- **THE STRIP IS `pointer-events:none`, AND THAT IS THE LOAD-BEARING
  PART.** It floats over the card's own first row, so anything it captured
  would be a click somebody aimed at the content underneath. `smoke-layout`
  caught exactly that on the first run: the head was eating a **link card's
  own URL field**. Only the delete ✕ is re-enabled. **The card name is a
  LABEL now** — it lost its `onclick`/`ondblclick`, because a clickable
  name covers a to-do's first checkbox; renaming is the rail's Rename, F2
  and the right-click menu, all three of which already existed.
- **`window.boardsHeadDblClick` is GONE.** It existed because a heading's
  drag strip sat over its banner and ate the first double-click (a QA
  finding). An inert head removes the cause, so the banner — and every
  other card body — receives that double-click itself.
- **The coloured top strip is its own 4px bar** (`.board-card-el::before`),
  no longer the header's background. Painting the two together meant a card
  could not have both. The tint rules moved to `::before` and now carry the
  FULL colour rather than its soft tint, which is what a 4px bar wants.
- **The head costs the column nothing on any type.** `_boardsMinCardH`
  charged 28px for every type but heading and photo; that is what cropped a
  fitted picture, and it is gone for all of them. **`_BOARDS_FILE_CHROME_H`
  is 66, re-MEASURED** (31 + 33 + 2) — it was 92 while the strip existed,
  so every PDF card is 26px shorter and four page-maths assertions read the
  constant now instead of a literal.
- **The export draws no strip either**, just the 4px colour bar, so the PNG
  and the PDF are the shape the screen is. The card's NAME is not lost — it
  is in the PDF's card index.
- **The selection handle is a white round dot on the corner and the comment
  badge is a blue PIN** (a teardrop with the count, point down), both read
  off the frames. In Milanote both OVERHANG the card's top edge; **ours
  cannot** — `.board-card-el` clips its own content to round its corners,
  and escaping that means wrapping every card in a second clipping element,
  a change to every card rule in the file for a few pixels. They sit just
  inside.
- **A to-do's first-row ✕ yields while the strip shows.** The head's own ✕
  lands on it and the two mean very different things — one removes a task,
  the other the whole card. **The layout probe does NOT hold that one** (the
  two centres happen not to overlap), so `tests/invariants.test.js` does,
  and "Remove this task" is on the right-click menu.

**THE RAIL FOLLOWS FOCUS, NOT SELECTION.** The video's structural finding:
the same to-do card gives three different rails depending on where the
caret is.

| Focus | Milanote's rail | ours |
|---|---|---|
| a task | Color · Labels · Reactions · Comment · Title · Due date · Assign · indent · outdent | the same |
| the list title | Color · Title · ⋯ | the same |
| a comment box | Text style · B · I · S · link | the text rail (built earlier) |

`_boardsTodoFocus()` reads `_boardsEditingEl`'s id, so nothing has to be
tracked; a card id containing a dash still resolves (the `(.+)-(\d+)$`
greedy match is asserted). Indent and outdent are **greyed rather than
hidden** when they cannot apply, which is what the video shows — the rail
renderer gained `it.off`, and an off button carries no act, so the router
never sees it.

**The to-do card, rebuilt.**

- **A TITLE** (`c.title`), and Milanote **offers it inline**: once a list
  has three tasks, "Add a title to this list? **Yes** / **No thanks**"
  appears at the foot of the card. Either answer sets `titleAsked`, so it
  is offered once and never nags. Both rows are MEASURED (21 and 27,
  `scratchpad/measure-v2.js`) and **charged to the card**.
- **Tasks NEST.** `it.depth`, capped at 4, 16px a level, and a task may only
  go one level deeper than the one above it — otherwise a list opens with an
  orphan at depth 3 under nothing. **Tab / Shift+Tab**, read before anything
  else so the browser never moves focus out of the card. Outdenting to 0
  deletes the field rather than storing a zero.
- **A per-task DUE DATE and ASSIGNEE.** The date is a plain `YYYY-MM-DD`
  string — the shape the Cutting registry's filter already compares, so it
  sorts as text with no Date maths per row — shown as Today / Tomorrow / a
  short date, and flagged when overdue and not ticked. The assignee is a
  `USER_DEFS` name behind a `typeof` guard, drawn as initials.
- **A TO-DO CARD IS AS TALL AS ITS LIST**, the way a table is as tall as its
  rows. Found by `smoke-layout` on this round's very first run: with a flat
  80px body a three-task list drew both "Add a task…" and the title prompt
  outside the card. `_boardsTodoMinH` counts the real pieces (row 26, title
  21, add 24, prompt 27, padding 12, border 2 — all measured) and **caps at
  12 rows**, past which the body scrolls; a 40-task list must not mint a
  1,100px card. **It counts ONE-LINE tasks** and cannot know that a long
  task wraps, so the layout fragment sets explicit heights and
  `tests/boards.test.js` holds the contract — the division the `+Row/+Col`
  strip already settled.

**A LINK CARD IS BORN AS ONE FIELD.** "Enter a link URL", Milanote's own.
Ours was born as three inputs, which is exactly the raw form Afnan put
beside theirs. The three-field form is still what "Edit link details" opens.

- Traced frame by frame (69.6–80s): paste a Pinterest URL, a spinner
  replaces the chain glyph, and within a second the card becomes a
  **portrait image card already sized to the picture**, captioned **"From
  Pinterest"** with the site name as an orange link back.
- **Ours does NOT convert on its own.** The link card is confirmed working
  on the live site, it keeps the URL clickable, and a silent conversion
  would throw the page away. **"Turn into an image card" is an explicit
  menu action**, and the page survives as `c.sourceUrl`, drawn as a "From
  pinterest.com" line under the picture. Only `_boardsSafeHref` decides
  whether that is a link at all.
- **A failed fetch is said INSIDE the card**, the way Milanote's is (42s,
  "Sorry, something went wrong…"), not in a toast that is gone before you
  look up. Text that is not a URL is **kept as the title** rather than
  thrown away — which is what Milanote did with "ASHI".
- **The description is editable** with Milanote's own "Add a description"
  placeholder. It was a read-only hydrated div.

**The colour panel drops its tabs where there is no paper.** A file card's
and a to-do card's panel in this video has **no tabs at all** — the
top-strip palette, the board's own colours, Custom colour. Only the NOTE
(the first video) gets Background | Top strip and the seven paper-and-ink
presets, because only a note has a text body sitting on paper. Re-checked
against the first video rather than trusting the earlier note.

**The labels panel is headed "Recently created"**, not the board's name,
and every row carries its own **⋯** — rename or remove, both board-wide,
both saying how many cards they touched. The library is DERIVED from the
cards, so a rename is a rewrite on every card carrying it.

**The dot grid is a PLACEMENT CUE, not the background.** Measured: the
canvas carries no dots at rest and they are painted for about 1.2s around
the moment a card is placed — every other sample across the whole 126s
reads zero texture. Ours painted them permanently. `_boardsFlashGrid` hangs
off `_boardsPlacementPoint`, which every placing path already consumes, and
is held for the duration of a card drag (which the video does NOT show; it
follows from what the cue is for).

**The image ⋯ menu is Milanote's order** — Download original image ·
Replace image · **Crop image to fill the card ✓** · Open original. The crop
entry is their "Crop Image to Fit Dot Grid": the cover/contain switch.
`c.fit` stores only the exception, so a card with no field is cropped and
nothing migrates. Ours says what it does rather than naming a grid the card
does not snap to.

**NOT BUILT, and deliberately:** the image rail's **Draw on** (annotating a
picture is a drawing surface), **Edit** (crop and rotate is an image
editor) and **Background** (removing a background needs a service). Each is
its own feature, not a variant of one. The three are named here so nobody
files them as missed. **SUPERSEDED the same week — all three shipped;** see
"Draw on, Edit and Background" below, which also corrects the image rail
recorded above (it carries no Rename).

**What the video could not settle, and is recorded as unknown:** whether a
non-image URL stays a link card rather than becoming an image card (only
one URL was ever pasted); what a to-do rail looks like with the card
selected and nothing focused (it never appears); and the file card's meta
line, which is three short items I read as Download / Open / a size but
could not resolve at six pixels tall, even after averaging eight frames.

Verified both ways: restoring the head cost fails ten assertions by name;
letting the head take pointer events fails the probe naming the link
field; putting the dot grid back on `.board-stage` fails the invariant;
painting a tint on the head fails it too; the old three-field link card
fails five; and a colour panel that always shows tabs fails two.
**Nobody has seen any of this on a real screen** — the sandbox cannot sign
in [29 Sept: a headless QA session can sign in and render — see "Sandbox limits"].

### Mood Boards — the column, rebuilt; and a 35 MB upload limit (Sept 2026)

Three asks in one message, with a drawing of the column Afnan wants:
*"increase file upload size to 35 MB MAX … this is how i want the collum to
look like … + improve function of drag and dop in collum as it does not
work properly"*.

**THE UPLOAD LIMIT IS 35 MB, AND IT IS CHECKED IN ONE PLACE.**
`_boardsUploadAny` is the single function every upload route goes through —
the drop, the file picker, Replace, the Unsorted tray, a board's cover
picture and the link-preview mirror — so the gate lives there. A guard on
any one of those six is a guard the other five walk straight past. There
was **no size check anywhere before this**; an oversized file was sent, and
Cloudinary's refusal came back a minute later as a card stuck on
"Uploading…".

- **It is OUR limit, not Cloudinary's, and the two are different numbers.**
  Cloudinary caps an unsigned upload by PLAN (10 MB on the free tier) and
  `cloudinary.com` is ~~unreachable from the sandbox **entirely**~~ *(SUPERSEDED 29 Sept
  2026: it answers from a session; an account's plan is a setting that needs its login)*, so which
  cap this account carries **cannot be checked from a session and is not
  claimed here**. What the code does is refuse what we already know is too
  big before sending it, and, when Cloudinary refuses something that
  passed, pass ITS message through with a line saying that number lives in
  the account's plan and nothing in this app can raise it.
- **The drop and the tray also PRE-check** (`_boardsSizeFilter`), so an
  oversized file never mints a card at all. Dropping eight files where one
  is 60 MB adds the other seven and **names** the one it left out — refusing
  the whole drop, or silently swallowing one, are both worse.
- **A remote URL STRING is not size-checked.** `_boardsMirrorPreviewImage`
  hands the same function a link-preview image's address, which has no size
  and is fetched by Cloudinary itself. Asserted, because a naive
  `file.size>MAX` would have broken link previews.

**THE COLUMN LOOKS LIKE THE DRAWING.** It was a 30px toolbar strip — an
uppercase muted name, a count chip and a ✕ in one flex row. It is a TITLE
BLOCK now: the name centred on its own line at 17px, `N cards` under it, a
divider, and the body as a recessed panel that says "Drag cards here".

- **The two corner buttons are absolutely positioned, not flex siblings.**
  Otherwise the title centres against whatever space is left and **shifts
  the moment the ✕ fades in**. They sit at `top:12px` so they clear the
  selection dot at 2,2 — a column wears the same dot a card does now.
- **The minus COLLAPSES, it does not delete.** A minus that deleted would
  be a worse lie than no button. `c.collapsed`: the column shrinks to its
  header, its children are **not drawn** and are otherwise untouched — they
  stay in `_editCards`, keep their positions, and the header still says
  "2 cards", so search, the exports and the reading order never notice.
  Expanding puts the list back exactly as it was. It is a way of LOOKING at
  a column, not an edit to it, and it pushes undo like every other
  mutation. **Delete keeps its ✕**, which appears on hover or once the
  column is selected — the rule the card head already follows.
- **`_BOARDS_COL_HEAD` 30 → 63, MEASURED** (`scratchpad/measure-column.js`,
  the real markup against the real stylesheet), never counted up from
  paddings: it is what the first child is laid out below, so a wrong value
  paints the panel over the first card. **It lives in two files** — the
  constant in `js/boards.js` and `.board-column-body`'s `top` in
  `css/main.css` — and `tests/invariants.test.js` now fails if they
  disagree. The test that hardcoded `142,252` reads the constants instead.
- **`_BOARDS_COL_MIN_H` 120 → 150.** An empty column IS the drop target, and
  at 120 with a 63px head its body was 57px — smaller than most of the cards
  being aimed at it. 87px now.

**DRAG AND DROP: THE RULE WAS AN INVISIBLE CENTRE POINT, AND THAT IS WHY IT
FELT RANDOM.** `_boardsColumnAt(card centre)` decided everything. MEASURED
before changing a line (`scratchpad/probe-drop-overlap.js`, driving the real
drag end to end): of **272 drop positions where the card visibly overlapped
an empty column by a quarter or more, 90 were refused — and a card sitting
45% inside a column still would not drop.**

That is not a bug in one line, it is the wrong rule. A person aims with the
CARD, and a card is nearly as big as an empty column, so "is the middle
pixel inside" reads as a coin toss.

- **`_boardsColumnForCard` picks the column sharing the most AREA with the
  card**, as long as that share is at least 30% of whichever of the two is
  **smaller**. `min()` is what makes both directions work: a small card well
  inside a big column, and a big card dropped squarely on a small column,
  are both obviously deliberate. The centre still counts on its own, so
  nothing that used to work stopped working. Re-measured after: **90
  refusals → 38, and every position from 30% overlap upward now drops.**
- **The trade, stated rather than hidden:** a card must now be dragged about
  **200px** — roughly 70% of its own size past the edge — to LEAVE a column,
  where the old rule let it fall out as soon as its middle crossed. That is
  the right way round: a nudge should not empty a column, and leaving one
  should be something you meant.
- **The indicator and the rule cannot disagree**, because the drop line and
  the `drop-into` highlight are both computed from the same
  `_boardsDropTargets`. The highlight moved onto the **body panel** — the
  border glow was mostly hidden under the card being dragged.
- A **collapsed** column takes no drops: it shows no slots to aim at, so the
  card lands on the canvas instead of vanishing into a fold.

**Verified by reverting each one:** the centre-point rule fails "the drag
path itself lands a 45%-overlapping card in the column"; dropping the size
gate fails the upload assertion; drifting the CSS `top` from the constant
fails the new invariant naming both numbers; and drawing a collapsed
column's children fails "its children are not drawn".

**A test lesson, and it is one this file already records.** The first drop
assertions called `_boardsColumnForCard` directly — and **stayed green with
`_boardsDropTargets` still wired to the old centre-point rule**, which is
the thing being replaced. Asserting a helper proves the helper. There is an
assertion that goes through the path the drag actually takes now. And the
first attempt at breaking the layout fragment **did not land** (the rule's
later `pointer-events:none` overrode the edit) and reported a clean pass,
which reads exactly like "the fragment has no teeth" — confirm the break
landed before believing either answer.

`tests/smoke-layout.js`'s column fragment grew the empty, the selected, the
long-named and the collapsed column, plus a second copy with the drop
highlight forced on, since the probe cannot drag. It is **one column of
columns**: a 280px column at x=300 sits past the right edge of the 420px
viewport, where the wrapper clips it and the hit-test reports its own
buttons as unreachable — the fragment measuring itself.

**Nobody has dropped a card into a column on a real screen** — the sandbox
cannot sign in [29 Sept: a headless QA session can sign in and render — see "Sandbox limits"]. The geometry, the drop rule and the collapse are measured;
the feel is not.

**THE FRAME WEARS THE SAME TITLE BLOCK** (*"now do the frame like the
column"*). Same centred name, same count under it, same collapse minus,
same corner ✕ on hover, same selection dot. The CSS is **one shared rule
per piece** (`.board-column-head,.board-frame-head{…}` and so on) rather
than a second copy — two copies drift the first time one is edited, and the
frame's header would then sit at a different height from the constant that
lays its contents out. An invariant fails if the sharing is undone.

Where the two genuinely differ, and why:

- **The count is GEOMETRY for a frame.** A column owns its children by
  `c.columnId`; a frame owns whatever sits inside it, so the number comes
  from `_boardsCardsInFrame` at render and nothing is stored — the
  membership-free rule frames have held since Stage 3.
- **A frame's region stays SEE-THROUGH** (`rgba(0,0,0,.05)` against the
  column's `.14` over a solid surface). A frame is a section of the CANVAS,
  often far larger than a column and holding cards spread across it; a
  solid fill would black out the board underneath over a big area. It gets
  the divider and the recess at a fraction of the weight.
- **Folding a frame has to REMEMBER its height.** A column's is derived, so
  expanding recomputes it; a frame's is whatever somebody dragged it to, so
  the fold keeps it in `openH`. That stored height is also what
  `_boardsCardsInFrame` measures against **while the frame is folded** —
  without it a folded frame reports nothing inside, says "0 cards", and
  **leaves its contents behind when it is dragged**. Asserted by driving a
  collapsed frame's drag: the two cards it hides move with it, the card
  outside it does not.
- **`_boardsMinCardH` for a frame: 60 → `_BOARDS_COL_MIN_H`.** 60 is UNDER
  the 63px title block, so a frame dragged to its minimum wore a header
  that overflowed its own box. Existing frames are not rewritten — the
  render grows a short one and the stored height catches up on the next
  resize, the module's standing rule.
- **`boardsColumnFold` became `boardsFoldContainer`** — one implementation
  for both, so the render, the count and the drag cannot disagree about
  what a fold covers (`_boardsHiddenByFolds`).

**A probe lesson worth more than the fragment.** The frames were first
added as more rows on the column fragment, which made that stack 1500px
tall — and **the layout probe SKIPS hit-testing anything below the window**
("off-screen at this width is a layout question, already covered above"),
so at a 1000px window the frames were not being checked at all. Found by
breaking the frame body to cover its own header and watching the probe
pass. They have their own fragment now, sized to fit, and the same break
fails naming `DIV.board-frame-body`. **A fragment taller than the window is
a fragment that stops testing partway down.**

### Mood Boards — the selection rail says what the card already has (Sept 2026)

Afnan: *"now do the same for the selection rail"*, after the tray and rail
drag ghosts.

**THERE IS NO GHOST HERE, and that was checked rather than assumed.**
`drag:true` appears in exactly three places in the file — `_BOARDS_RAIL_MAIN`,
`_OVERFLOW` and `_PHONE`, the add-tools — so nothing on the selection rail
is a drag source: its buttons act on a card that is already placed. A test
asserts that emptiness directly, so the premise of this round is on the
record rather than in prose.

What carries over is the PRINCIPLE the last two rounds were really about —
**show the real thing, not a generic stand-in** — and the selection rail
already had exactly one button obeying it: **Color**, whose `colorTile`
paints the card's own colour. **Labels, Reactions and Comment were
identical icons whether the card carried twelve or none**, so the only way
to find out was to open each panel in turn. They carry the count now.

- **`_boardsRailCounts(sel)` is DERIVED on every render**, never stored —
  the rule the label library and frame membership already hold.
- **LABELS ARE A SET; REACTIONS AND COMMENTS ARE TALLIES**, and the
  difference is the question each answers. Twelve cards all wearing "see
  this" are wearing **one** label — counting twelve would describe the
  selection's size rather than its labels. A reaction and a comment are
  each their own event, so those add up. Names are matched trimmed and
  case-folded.
- **`_boardsCommentCounts()` is THE definition of the comment count, and
  extracting it is the point.** It counts the **unresolved** ones, and the
  card's own corner badge reads it too — it used to be an inline loop
  inside the badge painter — so **a card can never say 3 in the corner and
  5 on the rail**.
- **A zero paints no badge.** A "0" chip on every button is noise on a rail
  whose whole point is being a short list of what you do often; an empty
  count is said by saying nothing.
- **The badge reuses `.board-rail-badge`**, the Trash count's own class, so
  the two can never LOOK different — but the value is rendered inline where
  Trash's is painted by id, because this count is on the card in memory
  right now while Trash's arrives from a Firestore listener. One look, two
  sources, and the sources genuinely differ.
- **A comment arriving repaints the rail.** The snapshot handler already
  repainted the card badges and the drawer; without adding
  `_boardsRenderRail()` the rail's number would quietly lie until the next
  render for some unrelated reason. It is an `innerHTML` swap on one
  element, and the mode-swap animation is keyed on a MODE change rather
  than a repaint, so this cannot replay it.
- The phone's selection bar carries the same three counts.

**Verified by reverting each piece:** the counts dropped from the rail,
labels made a tally, resolved comments counted, reactions counted per emoji
rather than per person, the malformed-card guard, and the null selection.
The fragment fails at **1:1** naming `board-rail-badge` when the ink is set
to its own chip. **And the rail was looked at**, rendered in real Chromium
beside a card carrying nothing.

**THE ASSERTION THAT MATTERED WAS THE ONE THAT FIRST HAD NO TEETH.**
Un-sharing the count rule — the single most important claim here, that the
corner badge and the rail cannot disagree — **stayed green**, because the
painter writes into DOM nodes the node harness has none of, so nothing
reached it. Registering those nodes and reading back what the painter wrote
is what closes it; that break now fails with `got "3", expected "2"`.
Asserting the shared map alone proved only that the map existed.

**Two of my own assertions crashed the suite instead of naming a finding**
(the malformed card and the null selection), and one section invented two
helper functions that do not exist — `_boardsRailHTML` and
`_boardsRailBtnHTML` — which threw and took the whole run down. The button
markup is built inside `_boardsRenderRail`'s own map and is not callable in
isolation, so the BADGE is smoke-layout's and the counts are this suite's,
which is the division the last two rounds already settled. Every assertion
goes through a try now.

**The fragment opts out of 420px.** The rail docks as a horizontal bar at
phone width, so two of them side by side land on top of each other and
report each other as covering — the fragment measuring itself, the
documented false hit. The phone bar is `tests/smoke-phone.js`'s.

**Nobody has seen the counts on a real screen** — the sandbox cannot sign
in [29 Sept: a headless QA session can sign in and render — see "Sandbox limits"].

### Mood Boards — every rail tool carries the card it will place (Sept 2026)

Afnan: *"now do the same for the rail drag ghost"*, after the Unsorted
one. Only **Note** had ever done this; the other seven placing tools showed
a generic chip that was the same size whatever you were about to drop, so a
Frame and a Note looked identical in flight and neither told you whether
the thing would fit where you were aiming.

**THE BLOCKER WAS RECORDED HERE AND THIS ROUND REMOVED IT.** The Note round
wrote: *"Other tools keep the chip: their sizes live in `_boardsNewCard`,
which is not pure."* That is exactly right — **`_boardsNewCard` MINTS AN ID**,
so it can never be called merely to ask how big a card would be, and the
ghost had no way to find out. `_boardsNewCardSize(type)` is that question,
pulled out as a pure function the card and the ghost both read, so **a ghost
can never promise a footprint the drop does not land**. A test asserts the
two agree for all ten types, and that asking twice mints nothing and moves
no counter.

It is written as the same ternary expressions rather than a lookup object
on purpose: several of those constants are declared much further down the
file, and a top-level object literal would read them **in the temporal dead
zone**.

**The ghost is a SILHOUETTE, deliberately, and the cost is named.** Drawing
the real `_boardCardHTML` would be the strongest "one definition", and it
is wrong here: that markup emits **ids and handlers**, and a second copy of
a card loose in the document hands every `getElementById` in this file a
duplicate to trip over. So the ghost draws the card's shape and its
first-run placeholder, and an invariant checks each of those words still
appears in the card markup — which is what stops the silhouette quietly
lying.

**WRITING THAT INVARIANT FOUND THE GHOST ALREADY LYING.** The Note ghost
has said **"Start typing…"** since the day it shipped, while the card that
lands says **"Double-click to type…"** — a placeholder that exists nowhere
else in the file. Every string is the card's own now: `Section title`,
`To-do` + `Add a task…`, `Enter a link URL`, `New Column` / `New Frame`,
`Drag cards here`. Verified by putting the old string back: the invariant
names it.

**A tool that PLACES NOTHING still gets the chip, and must.** `line` is a
mode and `imagepanel`/`file` open a picker, so there is no card to draw and
a card-shaped ghost would promise one. Two guards: the act must match
`add:<type>`, and `_boardsGhostBody` returns **null** for a type with
nothing to draw.

**Everything inside the ghost is sized in `em`** off the font-size
`_boardsRailGhostShow` sets to `15 × zoom`, so one rule set draws it at 25%
and at 300% with no per-zoom branches.

**The probe found a real bug on its first run, and it is the scrim lesson
again.** The frame ghost was `rgba(0,0,0,.05)` with no opaque base, because
the REAL frame is see-through — it is a section of the canvas. **A ghost is
not on the canvas.** It flies over whatever happens to be on screen (a
photograph, the dark rail, the top bar), so a translucent-only ghost has no
defined background and its title reads against pot luck: measured at
**1.11:1** in light mode, falling through to the page. It keeps the
`--surface` floor every other card ghost has and says "region" with a
**dashed** border instead — the language the drop targets already use.

**It is NOT merged with the tray's ghost, and that is deliberate.** They
answer different questions: the tray's carries a picture that already
exists, at a fixed size; the rail's carries a card that does not exist yet,
at the board's zoom. Forcing one implementation would be a shared thing
with two disjoint halves.

**Verified by reverting each piece:** only Note getting a card ghost, the
ghost inventing its own size, the size un-shared from `_boardsNewCard` (27
failures), a picker given a card shape, the type tag dropped, the zoom
ignored, and the size helper minting after all. Both fragment breaks fail
naming `ghost-name` and the band.

**Two lessons from my own tests, both already in this file and both caught
again.** An assertion that did `/type-(\w+)/.exec(cls)[1]` **threw and took
the suite down** instead of naming a finding — every new assertion is
null-safe. And the "a picker gets a card shape" break **stayed green**:
`imagepanel` never matches `add:` at all, so it exercised the outer guard
and proved nothing about `_boardsGhostBody`'s own refusal, which is
asserted directly now.

**Nobody has dragged a tool on a real screen** — the sandbox cannot sign
in [29 Sept: a headless QA session can sign in and render — see "Sandbox limits"]. The eight ghosts were rendered in real Chromium and looked at.

### Mood Boards — the drag ghost carries the picture (Sept 2026)

Afnan: *"now make the drag ghost show the actual image"* — the gap left
open by the round above, where the tray got bigger and better pictures
while the thing that flew out of it stayed a dark text chip.

**The chip said what KIND of thing was in flight, never WHICH one.** Two
model references a word apart in name produced an identical chip, beside a
panel whose whole point is that you recognise an item by its picture. It is
a small card now — the item's own picture with its name under it, shaped
like the tray row it came from, so **what is in flight looks like what was
grabbed**.

**`_boardsTrayFace(u)` is ONE decision, and extracting it was the point of
the round.** The row's thumbnail and the ghost both read it, so the picture
following the pointer can never be a different picture from the one under
it. It returns `{src, badge, cors}`:

- **`badge` is both the no-picture case AND the fallback** if `src` fails
  to load, so **nothing is ever faceless** — a ghost with neither picture
  nor word would fly as an empty box. Asserted across every kind.
- **`cors` picks which failure path the ROW takes**, preserving what each
  already did rather than unifying them: a photo or a link's own picture
  retries once WITHOUT the CORS attribute (`boardsImgFallback`, the
  documented cache trick), while a PDF's page-1 render is best-effort by
  design and falls back to the extension. **Reverting the row to its own
  copy of the branch fails six PRE-EXISTING assertions**, which is what
  proves the extraction changed no behaviour.
- **The width is pinned to 400 on both sides.** `_boardsDisplayUrl`
  buckets, so the ghost asks for the SAME url the row already loaded and
  paints from cache instantly; a different bucket is a fresh request and
  the ghost flies blank for the first moments of the drag. Asserted as a
  string equality, because that is the only way to hold "same url".

**`_boardsDragGhost(face,label)` is the one ghost, and Home's board rows
use it too.** They shared the class and the look already, so leaving one
behind was the drift this file keeps recording. A board supplies its face
through **`_boardsFaceOf`** — the single definition the gallery tile, the
panel row and the board card all read — so a board in flight looks like the
board it is. With no cover it paints its stored literal colour with the ink
**`_boardsInkOn` computes**, the board-tile rule: a literal ink is only
right where the background is literal too.

- **`pointer-events:none` is load-bearing, not cosmetic.** The drop is
  decided by hit-testing the pointer, so a ghost that could be hit would be
  a drop target flying under the very pointer it follows.
- **`object-fit:contain`**, the rule the tray thumbnail just took: a ghost
  that cropped would show a different part of the picture than the row the
  pointer just left.
- **Built with `createElement` and `textContent`**, never an HTML string —
  a label is a filename or the first line of somebody's note. Asserted the
  only way a node harness can: hand the builder a `<img src=x onerror=…>`
  and it comes back as TEXT with nothing parsed out of it.

**What holds what.** The ghost is built at drag time, so no fragment can
render the real builder: `smoke-layout`'s new `boards — the drag ghost`
measures the **CSS** (over a solid WHITE stand-in picture, so ink that
stops reading over a light photograph shows up), and `tests/boards.test.js`
pins the **class names** the builder emits, which is what keeps the two
from drifting. Same division the trash ramp uses. Each ghost in the
fragment gets its own `left`/`top` because the real thing is
`position:fixed` and they would otherwise stack at 0,0 and report each
other as covering — the documented false hit.

**Verified by reverting each piece:** the chip restored (8 assertions), the
CORS attribute dropped, a second size bucket, a faceless item, the label
interpolated as markup, the ghost left behind on drop, and the row
un-sharing the face. Both fragment breaks fail at **1:1** naming
`board-tray-ghost-label` and `board-tray-ghost-badge`. **And the ghosts
were looked at**, rendered in real Chromium — the one thing here that needs
no sign-in.

**A leak fixed in passing, in the exact path that bit this session.**
`tests/smoke-browser.js` removes its Chrome profile in `finish()` but its
launch-failure `catch` exited without doing so — and that is the path that
fires when the disk is already full, so it made a bad state worse. It is
what left the two orphans found while checking this round. Both other
probes were checked and clean.

**Nobody has dragged anything on a real screen** — the sandbox cannot sign
in [29 Sept: a headless QA session can sign in and render — see "Sandbox limits"].

### Mood Boards — the Unsorted tray: bigger, sorted, and not cropped (Sept 2026)

Afnan, with five items circled: *"make unsorted bigger for better drag to
drop movement + unsorted should have sort by category option in it as well
( links ) ( images ) ( files ) ( etc. etc. ) + the preview of unsorted
should be logically well as well as the current model preview is not
right."*

**THE PREVIEW WAS A REAL BUG, and it is the one that mattered.** The
thumbnail was `object-fit:cover` in a fixed **84px** box, so a picture
taller than it was wide rendered as the strip across its MIDDLE — a
full-length model reference came out as a pair of legs, which is what was
circled. A tray item is looked at to RECOGNISE it, so nothing about it may
be cropped away: it is `object-fit:contain` in a **160px** box now, the
whole frame on a `--soft` letterbox that reads as deliberate. The bigger
box is also half of "better drag to drop movement" — **the thumbnail IS the
grab target**.

**280px → 380px**, with the grid still two columns, so every item goes from
~125px wide to ~175px. The tray OVERLAYS the canvas off Home (it does not
inset it, unlike Home's panel), so this costs canvas — which is the trade
that was asked for.

**SORT BY CATEGORY.** Chips rather than the Boards panel's segmented
control: that one holds three fixed states, this holds however many kinds
the tray happens to contain and has to wrap.

- **`_boardsTrayKind` is ONE definition of which bucket an item is in**, so
  the chips, their counts and the filtered list cannot disagree. It keys on
  `u.kind` — the same field the row's thumbnail already switches on — which
  means a **stashed image card** (`kind:'image'` beside its `cards`) files
  under Images, where a person looking for a picture would go, rather than
  in a bucket of its own.
- **The chips are DERIVED from what is present**, with counts. A chip for an
  empty category is a filter that leads nowhere, and with fewer than two
  kinds the row does not render at all — one kind of thing needs no way to
  narrow it.
- **THE ROW CARRIES ITS INDEX INTO `_editUnsorted`, NEVER ITS POSITION IN
  THE FILTERED LIST.** `boardsTrayDragStart`, `boardsTrayRemove` and
  `_boardsTrayHydrate` all address an item BY THAT INDEX, so a filtered list
  that renumbered its rows would drag out, delete and label a DIFFERENT item
  than the one under the pointer — silently, and worse the more you filter.
  That is the whole reason `_boardsTrayRows()` returns `{u,i}` pairs. The
  test drives the real drag under an active filter and checks the card that
  lands is the one that was grabbed; reverting to a renumbering filter fails
  six assertions.
- **The filter SELF-HEALS.** Drag the last link out and it points at a
  category that no longer exists; a panel showing nothing with no chip left
  to press reads as broken, so a filter with nothing behind it simply IS
  "all" until something lands in it again. Derived on read —
  `_boardsTrayFilter` is never rewritten.
- **There is therefore NO "nothing in this category" screen**, and that is
  not an omission: the heal makes an empty filtered list unreachable while
  the tray holds anything. The first cut carried a branch for it and **the
  test is what proved that branch was dead code** — a handled case that can
  never run reads, in review, like a handled case.
- Clicking a chip repaints the **list and the chips alone**
  (`_boardsTrayRepaint`), like the Boards panel's own repaint: a full
  `_boardsRenderCanvasAndWire()` would redraw every card and connector on a
  46-card board to narrow a list of five. The hydrate runs after, because
  every label is written in with `textContent`.

**A LATENT BUG THE TALLER THUMBNAIL EXPOSED, and the probe caught it on the
first run.** `.board-tray-list` is `flex:1` inside a flex column, so it has
a DEFINITE height, and its auto rows were being sized to an equal share of
it — **measured at exactly `(height − padding − gaps) / rows`**. With an
84px thumbnail the content happened to fit that share, so nothing showed;
the moment the picture grew, every item was squashed to **136px around a
160px picture** and each label was laid out entirely outside its own
`overflow:hidden` card. `grid-auto-rows:min-content` sizes the rows to
their content, so the list SCROLLS instead of crushing what is in it —
re-measured: rows 206/190/206, `scrollHeight` 643 against a 447px list.

**The first fix for that was wrong and the measurement is what said so.**
`aspect-ratio:1` on the thumbnail sizes circularly inside a grid item (the
row height resolves before the ratio does) and produced the same clipped
labels. A fixed height needs no circular sizing.

**What holds what, and the gap that made an invariant necessary.**
`smoke-layout` holds the geometry, the contrast and the hit-testing — its
Unsorted-tray fragment fails 4 jobs with `grid-auto-rows` reverted and 6
with the chip ink broken. **It cannot see a CROPPED picture**: put
`object-fit:cover` back and all six of its jobs still pass, checked. So the
no-crop rule — the actual reported bug — lives in
`tests/invariants.test.js` instead, with the minimum height beside it so a
future tidy-up cannot shrink the target back.

**Verified by reverting each piece:** the renumbering filter, the heal, the
derived chips, the stashed-image bucketing, the chips-under-two rule, the
filter ignored outright, and all three CSS changes. **And the panel was
looked at** — rendered in real Chromium with a portrait stand-in, which is
what shows the whole figure where the old box showed a midsection.

**Nobody has dragged out of it on a real screen** — the sandbox cannot
sign in [29 Sept: a headless QA session can sign in and render — see "Sandbox limits"].

### Mood Boards — the Hand tool moves to the rail (Sept 2026)

Afnan, with the View menu open and an arrow drawn from its Hand row down to
the foot of the rail: *"i want this hand funtion to sit on side bar as it is
used very often."*

It was a row inside **View** — two clicks for a mode you flip constantly,
and **no state visible anywhere until you opened the menu again**. It is a
rail button now, directly after Fit, carrying the `.on` chip the Line tool
already uses. **It left the View menu rather than appearing in both**: a
toggle in two places is two things to find and two labels to keep in step,
the same "two surfaces for one action" rule that merged the rail and the old
selection bar.

**COMMENT CAME OFF THE RAIL TO MAKE ROOM, and that was FORCED rather than
chosen.** MEASURED with `scratchpad/measure-rail-hand.js` against the real
stylesheet in headless Chromium — never counted up from paddings, the
mistake this file records the rail making once already:

| tools | large tier | compact tier |
|---|---|---|
| 12 (before, and after) | 810px | 626px |
| 13 (Hand added outright) | 871px | 673px |

A 768px-tall laptop leaves about **631px** of stage (the canvas is a fixed
takeover, so only its own 50px top bar is above it). **Thirteen does not fit
and twelve does** — the `smoke-layout` rail check caught it on the first run
at both tiers (`scroll:868 client:863` large, `scroll:670 client:631`
compact) before any of this was reasoned about.

Given that, the tool to lose is the one **already sitting one click away on
a button you can always see**. The rail's `comment-board` opens
`boardsOpenComments(null)` — the board drawer — which is exactly what the
top bar's **Comments** button opens, and that button is permanently visible,
labelled, carries its own on-state and TOGGLES (the rail's only ever opened
it). It is also `${phone?'':…}`, so it exists at precisely the widths this
rail branch serves. **The phone keeps its own copy** in
`_boardsRailPhoneOverflow`, untouched.

- **Hand is NOT in `_BOARDS_RAIL_MAIN`, and that is what keeps it off the
  phone.** That list is the add-tools — it drives the "…" overflow, the
  drag-to-place flag, and **everything in it reaches the phone's More
  sheet**. A touch drag already pans unconditionally (`pointerType==='touch'`
  is the FIRST term of `wantPan`), so on a phone the toggle would be a
  control that changes nothing. Keeping it out of that list makes the
  exclusion structural rather than a branch somebody has to remember; the
  test asserts both the absence and the reason.
- **It takes no `--tool-*` hover colour, and neither does Fit.** The content
  tools are colour-coded because you pick one to *place a thing*; these two
  change how you *look* at the board. For a mode the affordance that matters
  is the `on` chip, not the hover tile.
- **The View menu's separator is now conditional.** Hand was the one row
  under it that always rendered, so a read-only viewer on a phone — no Snap,
  no Minimap — would have been left with a rule hanging off the bottom of
  the menu. Checked across all four role/width combinations, not reasoned
  about.

**Verified by reverting each piece**: Hand off the rail (8 assertions, one
naming `fit,trash` where `fit,pan` belongs), Hand before Fit, the `on` flag
dropped, the router case deleted, the View row restored, Comment put back
(`got 13, expected 12`), and Hand moved into `_BOARDS_RAIL_MAIN` (which the
phone assertions catch by name). **And the rail was looked at**, rendered to
a screenshot in real Chromium with the mode on — the one thing about this
round that could be seen from a session, since it needs no sign-in.

**Nobody has pressed it on a real screen** — the sandbox cannot sign in [29 Sept: a headless QA session can sign in and render — see "Sandbox limits"].

### Mood Boards — drag anything into Unsorted (Sept 2026)

Afnan: *"when inside a board you can drag anything link file image collum
etc and save it in unsorted so the board remains clean."*

The gesture is the small half. The big half is that **stashing was lossy
and nobody had noticed**, because the only route to it was a menu entry
and the four card types it could actually carry are the four people used
it on.

**A TRAY ITEM CARRIES THE WHOLE CARD NOW (`u.cards`), not a summary.** It
used to be hand-mapped — `imageUrl`, or `fileUrl`/`fileName`, or the link
fields, **else `{kind:'text',text:c.text}`**. A to-do has no `c.text` and
neither has a table, so "Move to Unsorted" on either turned it into an
**empty note**: a live data-loss bug reachable from the menu, not merely a
limit on the new gesture. Cards go through the same `_boardsEncodeRows`
boundary the trash uses — `rows` is an array of arrays, **Firestore
refuses those outright**, and `unsorted` is saved on the board document
exactly like `cards` is, so a stashed table is the same shape in the same
place. The old display fields are still written *beside* the card because
they are what the row's thumbnail and label read; they are a VIEW of the
card now, never the record of it. A row for a type the tray has no picture
for says which type it is (`COLUMN`, `TO-DO`, `TABLE`) through
`_boardsCardNoun`, the same type→word map the delete toast uses.

- **A CONTAINER TAKES ITS CONTENTS**, which is what "collum etc" asks for:
  a column parked without its children is an empty box, and children left
  behind are loose cards that used to be organised. Expansion happens
  inside `boardsTrayStashCards`, not in the callers, so the menu (which
  hands over one id) and the drag (which hands over a group it already
  expanded) cannot give different answers.
- **ONE ROW PER TOP-LEVEL CARD.** `_boardsStashRoots` decides which
  members of a group are the *reason* the others are there — by stored
  `columnId` for a column, by geometry for a frame, walking up so a column
  inside a frame rides with the frame. Five loose cards are five rows you
  can bring back one at a time; one column is one row that brings it back
  whole. Rolling a multi-selection into a single row would make the tray a
  place things disappear into.
- **Positions are stored RELATIVE to the root**, so the group lands in the
  shape it left in wherever it is dropped.
- **IDS ARE KEPT WHERE THEY ARE FREE.** A card's comments live at
  `mood_boards/{board}/comments` keyed by card id, so a card that goes to
  Unsorted and comes back keeps its thread. An id already taken — a remote
  merge put that card back while the item sat in the tray — is remapped,
  and `columnId` and the connectors are rewritten through the SAME map, so
  there is no branch that only runs in the rare case.
- **The lines come back too**, but only those with BOTH ends going: the
  trash's rule, since one whose other end stayed on the board has nothing
  to return to.

**THE UNDO SNAPSHOT HAD TO WIDEN, and that REVERSES the Stage 1 note
above.** `_boardsStateSnapshot` was cards and connectors only, which was
right while nothing moved data *between* the board and the tray. Stashing
broke it: Ctrl+Z restored the cards and left the copy in Unsorted, so the
same card existed twice — **an undo that duplicates is worse than no undo
at all**, and the toast promising Ctrl+Z would have been a lie. It also
closes one that was already there and had no symptom anyone would report:
the drag OUT of the tray pushes undo too, and Ctrl+Z used to take the card
off the board **without putting the item back** — the thing was simply
gone. Pan/zoom and typing are still deliberately outside it.
`boardsTrayRemove` still pushes no undo and still says "cannot be undone",
so that confirm stays true.

**THE GESTURE.** Dropping a dragged card on the Unsorted panel stashes it,
through `window.boardsTrayStashCards` — the SAME implementation the menu
calls, not a second stash path beside it. It is the Home panel drop
pointing the other way and wears the same `.panel-drop` dashed outline, so
there is one drop-target look whichever direction a card travels. The
drag's own undo entry is **popped** before the stash pushes its own, or
Ctrl+Z would put the cards back where they were *dropped* and need a
second press — the Home precedent exactly.

- **NOT ON HOME** (it has no Unsorted, and its panel drop already means
  "take this board off Home") and **NOT ON A PHONE** (the tray is the full
  width of the screen there, so it covers the canvas outright and there is
  no board left to drag a card across — the route stays the More sheet,
  which is what the phone audit settled for every gesture that does not
  survive 390px).
- **A board link is refused, and a group holding one is refused WHOLE.**
  Stashing a sub-board link would surface the child back in the boards
  list, which that card's own ✕ already does under a name that says so;
  and half-doing a mixed selection is worse than not offering the gesture.
  The target simply does not light up, so the refusal is visible before
  the pointer comes up rather than silent after it.
- **Locked cards stay put and are COUNTED** in the toast — the bulk-delete
  rule.
- **The menu also stopped offering this on Home**, where it pushed an item
  onto a board with no tray: saved on the document and reachable from
  nowhere, the stray-item state the panel has to apologise for. A small
  pre-existing bug, fixed in passing.

**THE PEEK ZONE, because a closed tray is not in the DOM at all.** Off Home
`_boardsTrayHTML` returns `''` when shut, so there would be nothing to aim
at. `_boardsStashZone` builds a 96px strip with `createElement` once the
gesture passes the drag threshold and removes it in the drag's own `up()`
(which runs on `pointercancel` too), so nothing sits over the canvas at
rest and a mid-drag render takes it with its container rather than
orphaning it. It is **`pointer-events:none`**: the drag runs on
document-level listeners and decides the drop by comparing the pointer to
the zone's RECT, so a zone that intercepted anything could swallow the
gesture it exists to serve. `tests/invariants.test.js` holds that, and
that no markup anywhere renders the class — verified by making it
`pointer-events:auto` and watching it fail by name.

**Verified by reverting each piece**, which is the only reason any of it
is claimed: the widened snapshot (both shapes — the true pre-change one
leaves the card in *both* places, which is the bug itself), the item's
`cards`, the container expansion, the drop hit test, the undo pop, the
board-link refusal, the both-ends connector filter, the row encoding, the
id remap and the container's card count each fail by name. Three of them
first crashed the suite instead of naming a finding, which is a blunter
failure than it should be, so every new assertion is null-safe.

**Two test lessons, both already in this file and both caught again.**
The undo assertion first ran against an EMPTY tray, where an undo that
wrongly wipes the whole array is indistinguishable from one that correctly
removes the row it just added — it seeds a row now. And breaking
`.board-tray-thumb-empty` by inserting a colour at the START of the rule
did nothing, because the rule declares its own `color` LATER and won;
reported as a clean pass, which reads exactly like "the fragment has no
teeth". **Confirm the break landed before believing either answer.**

`tests/smoke-layout.js` gained `boards — the Unsorted peek zone` (idle and
armed, both themes) and the tray fragment grew two stashed rows, one of
them a column with the longest label the tray produces.

**Nobody has dragged a card into Unsorted on a real screen** — the sandbox
cannot sign in [29 Sept: a headless QA session can sign in and render — see "Sandbox limits"].

### Mood Boards — "to do not moving properly", and the guard that caused it (Sept 2026)

Afnan sent a 24-second screen recording of a to-do card on DENIM DUMP 2K27.
**Read frame by frame with cv2** (900×952, 30fps): the card is grabbed by
its head strip — the bar carrying its name, its ✕ and a **grab cursor** —
and dragged, over and over, for **thirteen seconds**, and the card does not
move one pixel. Tracked by the card's own fill colour: x stayed at 378 from
frame 84 to frame 474 while the pointer left and returned eleven times. It
moves normally before and after, which is what made it read as intermittent.

**It is not intermittent. It is a dead grip, and three separate decisions
built it, each of them correct on its own.**

1. `boardsCardDragStart` called `setPointerCapture` **on the pointerdown**.
   A captured pointer **RETARGETS the click and dblclick that follow to the
   capturing element**, so a press that never became a drag stole the click
   from whatever was really pressed. This file has recorded that bug
   **five times under five names** — the delete ✕, the file card's Open, a
   table cell, a to-do item, a link's own anchor — and **every one was
   patched by hanging an `onpointerdown="event.stopPropagation()"` guard on
   the descendant.**
2. The second-video round made `.board-card-head` **`pointer-events:none`**,
   correctly: it is an absolute overlay across the card's first row, and the
   layout probe caught it eating a link card's URL field. **Its own
   `onpointerdown` has therefore never fired since** — a dead handler that
   reads in review exactly like a working grip.
3. So a press on the strip falls through to the row underneath — and on a
   to-do card that row is the task text, wearing one of the guards from (1).

**MEASURED rather than reasoned** (`scratchpad/measure-card-grab.js`, real
markup, real stylesheet, headless Chromium, hit-testing every point of the
strip): **42% of a to-do card's strip would start a drag, and none of its
middle.** The working 42% is an 8px sliver of left padding. And the exact
point in the video — mid-strip — lands on `.board-todo-text`, **shows
`cursor:grab`, and is BLOCKED**. That is the whole report, in one probe.

**The same measurement found a worse one nobody had reported: a link card
in either form state was draggable from NOWHERE — 0% of the whole card,
not merely of the strip.** `bodyDrag` excluded `type==='link'` ("they are
three form fields, and a drag starting in a text input would fight
selecting the URL"), which was right while the head was a real handle and
became a card that cannot be moved when it stopped being one.

**THE FIX IS THE CAUSE, NOT THE SYMPTOMS: the capture is LAZY now.**
`boardsCardDragStart` takes the pointer only once the gesture passes
`_BOARDS_DRAG_PX`, inside `move()`. A press that stays put never captures,
so a descendant's click and dblclick are never retargeted and **the guards
have nothing left to protect.** The listeners moved to the **document** —
without a capture the pressed element stops seeing the pointer the moment
it leaves — with a `pointerId` check so a second finger is a pinch and not
this drag, and `pointercancel` registered beside `pointerup` (a vertical
swipe on a to-do body is claimed by `touch-action:pan-y` and cancels).

What that let go of, and what it deliberately kept:

- **Gone: the guard on anything that is merely TEXT** — the to-do task text
  and list title, and a table's text cells. Each now drags like a note body
  drags, and each still double-clicks to edit. The table was the second
  instance the new probe found on its own: **~44% of a table card promised
  a grab and would not move**, since the grid inherits `cursor:grab` from
  the card body. The recorded cost of that guard — "a table drags by its
  chrome, not its cells" — was this same bug, unrecognised.
- **Kept: the guard on every real CONTROL** — the checkbox, the remove ✕,
  "Add a task…", a checkbox cell, the ✕ and the form fields. Its reason is
  different and still holds: a drag must not begin on something you are in
  the middle of pressing, and dragging to select the text in a field must
  not move the card.
- **The head's dead `onpointerdown` is deleted** rather than left beside a
  comment. The strip is chrome; the drag belongs to the body the press
  falls through to.
- **The link card gets `bodyDrag` like every other type**, and its edit
  form's three fields get the pointerdown guard they never had — which is
  what that exclusion was actually reaching for.
- **`body.board-dragging .board-world{user-select:none}`** plus a
  `removeAllRanges` at the threshold: the four pixels before the capture
  can start a text selection the drag would otherwise smear across the card.

**THE REGRESSION TEST IS THE INTERESTING PART, and the first version of it
was the wrong test.** It began as "most of the head strip must be
grabbable", which needs a threshold, and a threshold is an argument — it
flagged link forms and locked cards, which are *correctly* not grabbable.
The rule that needs no threshold and no list of card types is:

> **Wherever a card paints `cursor:grab`, a press there must start the
> drag.** Nothing else on a card may claim that cursor.

`tests/smoke-layout.js` hit-tests every point of every card and checks
exactly that. It is silent on a link form (its fields paint a text caret,
so they promise nothing), on a locked card (`.board-card-el.locked
.board-card-body{cursor:default}` — already there, which is the CSS
independently agreeing with the rule) and on a card with the pen on
(`cursor:crosshair`). **Verified by restoring the guard: it fails naming
`board-todo-text`, 990 of 2912 points.** A new fragment, `boards — every
card type can be grabbed`, renders all eight types selected so the strip is
painted and reachable.

`tests/invariants.test.js`'s old "ondblclick inside a drag surface needs the
guard" rule is **replaced, not deleted** — its premise (an eager capture)
is gone. What it guards now is the mechanism: the capture must come after
the threshold, the tracking must be on the document, the head must carry no
handler while it is `pointer-events:none`, and every text field a card
renders must still stop pointerdown. **If `setPointerCapture` ever moves
back onto the pointerdown, all five old bugs return at once**, which is
what that assertion exists to catch.

**`tests/harness.js`'s `document.removeEventListener` was a no-op** and had
to become real: harmless while every document listener was registered once
at load, and not harmless the moment a GESTURE registers them — a second
drag in one test would fire the first drag's stale handlers.

**Nobody has dragged a card on a real screen** — the sandbox cannot sign
in [29 Sept: a headless QA session can sign in and render — see "Sandbox limits"]. What IS measured, in a real browser, is that the exact point in Afnan's
recording now resolves to "the card drags" where it resolved to "BLOCKED by
.board-todo-text" before.

### Mood Boards — Draw on, Edit and Background (Sept 2026) — REVERSES "NOT BUILT"

Afnan: *"now do draw on, edit and background"*. The three tools the round
before had recorded as **NOT BUILT, and deliberately** ("annotating a
picture is a drawing surface, crop and rotate is an image editor, removing
a background needs a service"). Two of the three turn out to need neither a
dependency nor a service; the third is honest about what it needs.

**The rail was READ OFF THE FRAME at 82s** (second video, full resolution),
and it CORRECTS what was written here a round earlier. A selected image
card's rail in Milanote is

    Color · Labels · Reactions · Comment · Draw on · Edit · Background ·
    Caption · ⋯

with **no Rename** — the "Rename before Caption" claim was read off the
**to-do** card at 112s and applied to the wrong type. Rename is not lost:
`_boardsMoreItems` derives ⋯ from the right-click list minus whatever the
rail carries, so dropping it from the rail put it in ⋯ with no other edit,
the same algebra that already moved Replace and Download there. **None of
the three panels is ever demonstrated in either video** — the image card
leaves the screen at 88s — so everything below is built from the names and
the glyphs (a pen nib, crop marks with a rotate arrow, a dashed frame
around a picture) and none of it claims to match theirs.

**DRAW ON.** `c.strokes = [{c:<palette name>, w:<px>, p:[x0,y0,x1,y1,…]}]`,
one SVG overlay per card.

- **The points are FLAT, and that is not a style choice: FIRESTORE DOES NOT
  SUPPORT NESTED ARRAYS.** A list of `[x,y]` pairs inside a card inside the
  cards array is exactly the shape that meant a table's `rows` never
  persisted at all — every save refused with "Nested arrays are not
  supported", the only symptom a repeating "Save failed". Flat needs no
  encode/decode boundary of its own, so there is nothing to keep in step.
  The test **drives the real pointer handler** rather than reading a
  hand-written fixture, because a fixture could be flat while the handler
  pushed pairs and the rule would still read green.
- **Normalized 0..100 of the card's BODY box**, with `preserveAspectRatio=
  "none"`. The trade-off is stated rather than hidden: a stroke stretches
  with the card, so resizing non-proportionally turns a circle into an
  ellipse and slides an annotation off what it was circling. Glueing
  strokes to the PICTURE instead needs the natural dimensions the Edit tool
  goes and fetches, so it would be unusable on every card written before
  this. The body is what you see and needs nothing stored.
- **The overlay is a DIV wrapping the svg.** An `<svg>` is a REPLACED
  element: given `top:0` and `bottom:N` with no height it takes the
  viewBox's intrinsic 1:1 ratio instead of stretching — **MEASURED at 240
  tall inside a 360 card**. A div stretches; the svg fills it.
- It is a **SIBLING of the body**, not a child, so one rule covers every
  card type: the head is an absolute overlay and the foot sits below the
  body, so the body runs from the card's top edge down to
  `_boardsCardChromeH(c)` above its bottom, which the render sets inline.
  **z-index 3 — under the head strip's 4**, or it would swallow the delete
  ✕; `pointer-events:none` unless the pen is on this card. `smoke-layout`
  catches both (making it `auto` at z 9 fails naming `svg.board-draw
  drawing` as covering the ✕).
- **ONE UNDO ENTRY PER STROKE**, pushed before the stroke is appended. A
  drawing tool where Ctrl+Z wipes the session is not a drawing tool, and
  the rail's "Undo stroke" is the same action under a name you can see.
- **It is the rail's SIXTH mode** (nothing selected / a card / a line / a
  cell / text / drawing) and outranks all of them. Like line mode it is
  **reset on board open** — a mode that survives leaving the board is the
  bug the QA round found in `_boardsLineMode` — and on selecting anything
  else, and on Escape (read BEFORE the editable bail, like Escape and
  Alt+Arrow already are).
- **On a PHONE the pen's settings go behind one button.** The rail there is
  a horizontal dock, and six colour swatches beside three width buttons and
  three labelled tools ran off the right edge at 390 and 360 — **found by
  `tests/smoke-phone.js`, not by reading**. Phone rail: `Done · Pen · Undo ·
  Erase`, with Pen opening a bottom sheet, the pattern Colour, Labels and
  Reactions already follow there.
- The PNG/PDF exporter draws the strokes from the same `c.strokes` — one
  drawing, two renderers, the rule this module holds for connectors.

**EDIT — crop and rotate, and deliberately NOT a Cloudinary transform.**
`a_90/c_crop,x_…` was the obvious route and it is the wrong one here: ~~the
sandbox cannot reach `cloudinary.com` AT ALL, so the string could only be
constructed and hoped for — the one thing this file's ground rule forbids.~~
*(SUPERSEDED premise, 29 Sept 2026: `cloudinary.com` answers from a session; whether a
transform string works on this account's delivery URLs was not tried, and the account's add-ons
need its login — so the reason is "unverified", no longer "unreachable".)* The arithmetic
needs no service, no add-on and no network, and it is measurable in a browser from a session.

- `c.rotate` ∈ {90,180,270} and `c.crop` = {x,y,w,h} normalized **within
  the ROTATED frame**, so rotating after cropping does not rewrite the
  crop. Both non-destructive: the stored `imageUrl` is never touched,
  Reset puts the whole picture back, and a card with neither field renders
  through the same plain `object-fit` path it always did — **nothing
  migrates**.
- **`_boardsImgGeom(c,boxW,boxH)` is the ONE definition**, pure, read by
  the DOM render AND the export canvas, so a crop cannot look one way on
  screen and another in the PNG. The element is laid out UNROTATED and
  turned about its own centre, because that is the only placement CSS and
  canvas agree on. **MEASURED in headless Chromium** (`scratchpad/
  measure-imgtools.js`) against five cases, every one exact: a 90° turn of
  a 1000×1500 covering a 360×240 card; the middle half drawn 480×720 at
  −120,−240 in a 240 square; a crop of a rotated picture 600×400 at −60,0.
- **`_boardsCardBodyBox` and the 2px that mattered.** `*{box-sizing:
  border-box}` so `c.w` includes the card's 1px borders — **except on a
  photo card, which has none** (`.board-card-el.type-image.photo{border:
  none}`). The first cut subtracted 2 everywhere and left a 2px strip of
  the card showing along one edge of every cropped picture. Measured both
  ways: 240 for a photo card, 238 for everything else.
- **`_BOARDS_CHROME_H.caption` was wrong: 27 → 30.** Re-measured while
  building this: `.board-caption` is 13px at line-height 1.4 (18.2) + 5px
  padding top and bottom + a 1px border-top = **29.2**, so a captioned card
  at its minimum clipped 2px off its own caption. Rounded UP, because
  over-counting a box costs a hair of a cover-fitted picture while
  under-counting leaves a strip of the card showing through.
- **Known slack, unchanged:** with BOTH a label row and a reaction row the
  foot's padding is counted twice (the documented 7px), so the overlay and
  the cover-fit are 7px conservative on such a card. Measured: a real foot
  is 54.9 against the constants' 62.
- **A fixed overlay, not an in-card editor** — a crop handle inside a 240px
  card on a board at 40% is a target nobody can hit, and the card is where
  you judge the RESULT. `100dvh`, not `inset:0`.
- It **opens by loading the picture at its ORIGINAL url** and refuses
  rather than guess if that fails: the natural size is what the whole
  geometry is expressed in, and a card written before this carries none, so
  the editor is what supplies `c.imgW`/`c.imgH`. Apply stores them WITH the
  edit and **re-fits the card through the same `_BOARDS_IMG_CARD_W`/`MAX_H`/
  `MIN` clamps a freshly uploaded picture goes through** — otherwise a
  portrait crop of a landscape photo sits in a landscape box and is cropped
  a second time by `object-fit`, the bug `_boardsFitImageCard` exists to
  remove.
- **Rotating carries the CROP with it** (a quarter turn maps (x,y,w,h) →
  (1−y−h, x, h, w)), so the framing stays where it was instead of jumping
  to a different part of the picture. Rounded to 6dp — `1-0.2-0.4` is
  `0.39999999999999997`, and a round trip has to come back exactly.

**BACKGROUND — two things on one menu**, the way the board look sheet put
four ways to fill a tile on one sheet.

1. **Remove the PICTURE's background** (`c.nobg`) — a Cloudinary
   `e_background_removal` DELIVERY component, so nothing is re-uploaded and
   clearing the flag puts the original straight back. It is a **PAID
   ADD-ON and whether this account has it CANNOT be checked from a
   session**; the menu says so in a note rather than letting a broken
   picture say it, and `boardsNoBgFailed` clears the flag, repaints and
   names the add-on when the `<img>` reports an error. The **export reads
   the same delivery URL**, or the background would come back in the PNG
   and the PDF only.
2. **Use the picture as the BOARD's background** (`b.bgImage`/`b.bgFit`) —
   "board backgrounds" has been on this file's deliberately-missing-vs-
   Milanote list since the parity round, and a picture already on the board
   is the obvious place to set one from. **`mood_boards`' update rule
   carries no field allow-list, so this needs NO `firestore.rules` change
   and no republish.** The URL is validated on the way in AND again in the
   save payload with the anchored `_boardsCoverUrl` — it goes straight into
   a CSS `url()`, and `res.cloudinary.com.evil.test` must not pass.
   It paints on **its own element inside `.board-stage` and outside
   `.board-world`**: the stage already carries a background-image (the
   dot-grid cue) and two would fight, and a background that panned with the
   cards would be a picture nobody could ever see the edge of.

**Verified both ways**, each by reverting it: the photo-card border term
(fails naming the body box, 238 vs 240), nested stroke points (fails with
`[[10,10],[40,60],…]`), the undo-per-stroke push (0 vs 1), the board-open
reset (`p` vs null), the crop rotation (the framing does not move), the
export's nobg URL, the overlay's z-index and its div wrapper, the board
background's validation, the phone pen rail (`draw:clear` off the right
edge), and the editor's own ink (1:1 in both themes).

**A test lesson, the `_pending` hazard wearing a THIRD face.** The
board-open assertion first shared its block's app instance, so every later
synchronous section in the suite ran before the await resolved and left
`_boardsDrawOn` in some other state — **it passed with the reset deleted**.
It has its own `loadApp` now. And `tests/smoke-phone.js` learned to skip a
rail button the renderer greyed out: it carries no `data-act`, so
hit-testing it reports the rail itself — a false positive of the same shape
as a scrolled-away control.

**Nobody has seen the pen, a cropped picture, the editor or a board
background on a real screen** — the sandbox cannot sign in [29 Sept: a headless QA session can sign in and render — see "Sandbox limits"].

### Mood Boards — the image card, like Milanote's (Sept 2026)

Afnan: *"now do the image card like milanote."* Read off the video at 34s
and 112s (4× zoom of one photo card): **a photo is the whole card** — no
strip, no border, no name text, corners reading as square-to-barely-rounded
at that resolution — with **a small comment-count badge in its top-right
corner** as the only chrome. Selected (112s), its rail is **Color · Labels ·
Reactions · Comment · Rename · Caption · ⋯**. **Milanote's hover state on a
photo is NOT in the video** — that half is built from our own heading card,
and is not claimed to match.

- **The head strip STAYS in the DOM and becomes an overlay** (`.photo`,
  set by `_boardsIsPhotoCard(c)`: an image card that has its picture and
  is not uploading). It is the drag handle a locked card still needs and
  it holds the name, the padlock and the delete ✕, so removing it would
  have been four features; overlaying it costs nothing. Literal white ink
  on a **solid `rgba(0,0,0,.6)` floor** — the scrim lesson: a fade to
  transparent measured **1:1 in light** over the white stand-in picture
  (verified by putting the fade back). An EMPTY image card and one still
  uploading keep the ordinary strip: a card whose only chrome shows on
  hover is an invisible box until it has something to show.
- **Hidden by VISIBILITY, not only opacity.** An `opacity:0` strip still
  takes the pointer, so on a phone — no hover — a tap on a photo's top-right
  corner would have reached an invisible delete ✕. `visibility:hidden` makes
  it un-hit-testable; the first tap selects the card, which shows the strip
  (`.selected`, the same class hover uses). **The heading card's overlay
  still has the opacity-only shape** — same exposure, not touched here.
- **THE CROP IS GONE, and that is the bigger half.** `_boardsFitImageCard`
  sets `c.h` to the PICTURE's height, and the render then put a 28px strip
  inside that height — so `object-fit:cover` cropped 28px off every fitted
  picture since the day the fit shipped. **Measured in headless Chromium
  (`scratchpad/measure-photo.js`): a 1000×1500 photo fitted to 240×360 drew
  its picture at 238×332 before, 240×360 after.** `_boardsMinCardH` charges
  a photo no head height now, the way it already charged a heading none;
  caption, labels and reactions still grow it. **Existing cards are not
  touched** — the box is the same size, only the picture fills it.
- **The badge is emitted OUTSIDE the head on a photo**, pinned to the
  picture's corner under the same `board-cmt-<id>` id the painter fills, so
  `_boardsPaintCommentBadges` needed no change. **It cannot overhang the
  corner the way Milanote's does** — the card clips its own content — and
  it keeps the app's `--accent-warning` chip, not Milanote's blue.
  **The layout probe found it sitting exactly on the ✕** in the strip (both
  in the top-right); the strip carries `padding-right:30px` so the ✕ sits
  left of the badge. Found by `smoke-layout` before shipping, not by a
  screenshot after.
- **A Top strip colour on a photo still paints.** The photo rules are the
  SAME specificity as the tint rules and sit BEFORE them, so `.tint-<n>`
  wins the background; a `[class*=" tint-"]` rule hands the ink back to
  `var(--text)` for that case (white on a soft tint would be 1.3:1).
  `.locked` (amber pair) and `.tint-custom` are later and higher, so they
  win exactly as on any card — measured: green-soft/`#111`, amber-soft/
  amber, in both themes.
- **The rail for an image is Milanote's exactly**: ~~Rename BEFORE
  Caption~~ — **WRONG, corrected the same week**: that was read off the
  TO-DO card at 112s. The image rail carries **no Rename** and three tools
  this note never saw (Draw on · Edit · Background); see "Draw on, Edit and
  Background" above. **Replace / Download are off the rail** — not lost, because
  `_boardsMoreItems` derives ⋯ from the right-click list minus the rail,
  so taking them off the rail put them in ⋯ on its own (asserted, with the
  "nothing lost between the two" algebra). **A file card's rail is
  unchanged** — it was not in the video.
- **The PNG/PDF export draws no strip on a photo** and clips it at the
  same 4px radius, so the export is the shape the screen is; it used to
  draw a 20px strip the screen drew at 28.

`tests/boards.test.js` (+24) holds the predicate, the badge placement, the
head cost and the rail; `tests/smoke-layout.js` gained **`boards — photo
cards`** (three selected photos — plain, tinted, locked — a badge painted
on an unselected one, the minimum-height photo with caption, label and
reaction, and an empty image card), over a solid WHITE picture so a scrim
that fades is caught. Verified both ways: restoring the head cost fails
"a photo needs no head height" (`got 120, expected 92`); the fading scrim
fails the fragment at 1:1 in light; dropping the padding fails it naming
`board-cmt-badge on-photo` as the coverer. **Nobody has seen a photo card
on a real screen** — the sandbox cannot sign in [29 Sept: a headless QA session can sign in and render — see "Sandbox limits"].

### Mood Boards — the colour panel, like Milanote's (Sept 2026)

Afnan: *"now do the color panel on the card like milanote."* Read off the
video at full resolution (36.6–37.6s): **Background | Top strip** tabs,
each with a glyph (a filled tile; an outlined tile with a thick top edge);
a **5-wide grid** of twelve tiles with the current pick ringed — default,
grey, teal, green, tan, yellow, orange, red, pink, purple, sky, blue, and a
checkerboard "transparent" — a divider; a row of seven **"A" tiles**, each
a pastel paper with a coloured A; a divider; a row of colours **taken from
the board's own pictures** (reds, browns and greys on that board); and
**Custom color…** with a colour wheel. Picking red made the note red at
once (38s).

- **The palette IS Milanote's now: eleven names plus none**
  (`_BOARDS_COLORS`), in the video's order. Orange keeps the name `amber`
  because existing cards store it; **"transparent" is deliberately not
  built** — our canvas is a plain surface, so it would be "none" twice.
  Six new token PAIRS (`--sw-<name>` / `--sw-<name>-soft`, both themes)
  join the five accents, and **`_BOARDS_COLOR_TOKENS` is the one
  name→token map**: the CSS rules are generated from it and the exporter
  reads it, so a name cannot paint on screen and vanish from the PNG. Blue
  and purple gained the head band the other strips already had (they had
  no soft token when they shipped). Every palette-keyed rule set — cell,
  column, frame, strip, paper, swatch, rail tile, heading — carries all
  eleven; the invariant that every `_boards*` helper is defined still holds.
- **The "A" row is seven PAPER-AND-INK presets** (`_BOARDS_CARD_THEMES`),
  each a paper name and an ink name from the same palette, so a pair
  inverts with the theme like any single colour. `c.ink` is new and is
  painted by `.ink-<name>` on the body; **it is set only by a preset, and a
  plain paper pick clears it** — red ink kept across a pick of red paper is
  the failure that rule prevents. Every preset was MEASURED with real text
  in both themes: **5.30–8.46:1 light, 5.16–7.98:1 dark**; every paper
  under `--text` reads ≥ 15:1 light / ≥ 11:1 dark. The strip tab has no
  presets — a preset is paper plus ink, and the strip is neither.
- **"From this board" is DERIVED at panel open** (`_boardsBoardPalette`):
  the image cards already in the DOM are drawn onto a 16×16 canvas and
  their pixels bucketed (`_boardsPaletteAccumulate` / `_boardsPalettePick`:
  4-bit buckets, mean colour per bucket, near-twins folded, capped at
  eight). Nothing is stored. They load with `crossorigin="anonymous"` — the
  same CORS-enabled entry the exporter relies on — and a picture the host
  would not let us read taints its canvas and is skipped, so one picture
  costs one picture, never the row. Cached per set of pictures, since the
  live panel repaints on every pick. **The row does not exist in the node
  harness** (no canvas), which is asserted; the pixel maths is driven with
  synthetic pixels instead.
- **A LITERAL colour on a card is allowed now, and only through validation.**
  A "from this board" tile or Custom colour… stores a `#RRGGBB` in `c.bg`
  or `c.color` — `_boardsColorValue` is the one gate (a palette name, or
  `_boardsValidHex`, else none). It paints as `.bg-custom` / `.tint-custom`
  with the hex in `--card-bg` / `--card-strip` **and its ink computed by
  `_boardsInkOn` in `--card-ink` / `--card-strip-ink`** — the board tile's
  rule: a literal ink is right where the background is literal too, so it
  reads in both themes without inverting. Nothing unvalidated reaches a
  style attribute (`_boardsCardColorClasses` / `_boardsCardColorStyle`;
  garbage stored on a card paints nothing, asserted). The rail's Color tile
  reads a literal inline the same way. **This reverses the first colour
  panel's "no Custom colour…"** — that note feared a literal paper under
  `var(--text)`; the computed ink is what answers it.
- **Custom colour… reuses the HSV sliders** through a third picker target,
  `{kind:'card', id:'bg'|'strip'}`, routed by the existing
  `_boardsColorCurrent` / `_boardsColorApply` pair rather than a second
  picker; the sliders' "‹ Presets" reopens the panel on the tab it left.
  The panel is a `.board-ctx` and the sliders are a sheet, so the panel
  closes first.
- **The phone's Colour sheet** gets the widened palette and the presets
  row; the board-palette row and Custom colour… are desktop-only this
  round.

**The probe had been measuring EMPTY note bodies, found here.** The colour
fragment filled its bodies by matching `class="board-text-body"`, but the
real markup is `class="board-card-body board-text-body"` — the match never
fired, so every paper in that fragment (and the min-height note in the
labels fragment) was measured with no text at all, from the day it was
written. Found by making `--sw-teal` equal to its soft and watching only the
A tile fail. Both fills match the real class list now; the same break fails
the card body at **1:1** as well. **A fragment that hydrates text must be
checked by breaking the ink, not by reading the fill.**

**Nobody has seen the panel, the presets or a literal-coloured card on a
real screen** — the sandbox cannot sign in [29 Sept: a headless QA session can sign in and render — see "Sandbox limits"].

### Mood Boards — phone share: "Share → Groovy Ops" (Sept 2026)

The first gap built from the Milanote gap study (four research agents,
28 Sept 2026; Milanote itself is unreachable from the sandbox, so a Claude
in Chrome study was briefed to fill in how it looks and behaves). The
installed app now appears in the phone's **Share** menu; a shared photo,
file, link or text lands in the **Unsorted** of a board the person picks.

- **Three halves, one route.** `manifest.json` `share_target` (POST,
  multipart, file field `files`) → `sw.js` `handleShare` parks the share in
  Cache Storage (`groovy-share-inbox`: a `/__share/<id>/meta` JSON entry
  plus one entry per file) and 303s to `/index.html#share=<id>` →
  `js/boards.js` reads it back through the existing deep-link consumer
  (`_boardsParseHash` / `_boardsConsumeDeepLink`, same Creative Hub gate).
- **The bucket is NOT named `groovy-ops-*`** — the activate handler deletes
  every such cache from a prior version, and a deploy landing between the
  share and the page reading it must not eat it. Entries older than a day
  are swept on every share.
- **A picker, not an inbox board.** Recently opened boards first, search by
  name; Home (no Unsorted), templates and boards you cannot edit are left
  out. `_boardsSharePlan` is the one pure decision: Android usually puts
  the link INSIDE `text`, so a link found there wins; otherwise the text
  (or title) becomes a note. Files go through `_boardsTrayAddFiles`, so the
  35 MB limit and the Cloudinary upload are the ones every other route uses.
- **Forgotten only once delivered.** Closing the picker keeps the share
  until the sweep, so a mis-tap is not data loss. An account without the
  hub is told and the share is dropped.
- Classes are `board-sendto-*` — `board-share-*` already belongs to the
  board's Share (people) modal.
- `netlify.toml` 303s a POST to `/share-target` to `/index.html` when no
  service worker controls the page (first open) — the share is lost there,
  but the person lands in the app rather than on an error. **Unverified**
  that Netlify applies a 303 redirect to a POST.
- `tests/share-target.test.js` (47) runs the real `sw.js` handler against a
  fake Cache Storage and the real page flow end to end. Verified by
  reverting the text-link search (5 fail), naming the bucket `groovy-ops-*`
  (3) and not dropping a refused share (1).
- **Nobody has shared into the app from a real phone.** Android only offers
  a share target for an INSTALLED PWA, and may need the app reinstalled (or
  a while) before the new manifest is picked up. iOS Safari does not
  support Web Share Target at all — iPhones will not see it.

### Mood Boards — Move to board… (Sept 2026)

The second Milanote gap. **The rule is Milanote's (help centre, search
summary — not seen in the product): a card moved to another board lands in
THAT board's Unsorted.** This is the menu half — right-click, ⋯ and the
phone More sheet, in the clipboard block after Move to Unsorted. **The drag
half (hold a card over a breadcrumb until that board opens) waits for the
Claude in Chrome study's measured hover time**; it will call the same
`window.boardsMoveCardsTo(targetId, ids)`.

- **It is the stash aimed at another board**: `_boardsExpandGroup` (pulled
  out of `boardsTrayStashCards`, which now calls it too — a column takes its
  children the same way in both) and `_boardsStashItem` (the whole card,
  rows encoded; only lines inside one row travel — the Unsorted rule).
- **The target is written FIRST, in a transaction that appends to the
  SERVER's `unsorted`**, never this tab's copy; only once it commits are the
  cards taken off this board. A failed write moves nothing and says so. It
  needs a connection, like every transaction.
- **Ctrl+Z must not bring a moved card back** — it now lives on another
  board, and a restored copy here would be the same card twice.
  `_boardsPurgeHistory` strips the moved ids from every undo/redo snapshot
  and keeps the rest of the history; the toast says undo will not return
  them.
- Refused: a board link (as in the stash), this board, Home (no Unsorted),
  templates, boards you cannot edit; locked cards stay and are counted.
- **Comments on a moved card are not carried** — they are keyed by card id
  under the source board's `comments` subcollection. **Known race:** someone
  with the target board open who saves its head before their live listener
  adopts the new Unsorted would write their older copy over it.
- Activity `Board cards moved` falls in Monitor's Process bucket (checked).
- `tests/board-move.test.js` (28). Verified by reverting: appending to this
  tab's copy of the target, dropping the history purge, dropping the board-
  link refusal — each fails by name.

### Mood Boards — sharing roles: edit, comment, view (Sept 2026)

The third Milanote gap (help centre, search summary: a board is shared per
person as edit, comment-only or view-only). **`firestore.rules` CHANGED —
it needs a republish.**

- **Two lists beside `sharedWith`:** `sharedView` and `sharedComment`. A
  person on `sharedWith` and on neither list can EDIT — which is what every
  board shared before this already meant, so nothing migrates.
  `sharedWith` stays the read list (the `array-contains` query and the read
  rule are untouched). `_boardsShareRole(b,email)` is the one reader;
  `_boardsSharePatch(picks)` builds the three fields from the sheet (pure).
- **`_boardsCanEdit` respects the role**, and every one of its ~116 call
  sites follows with no edit. `_boardsCanComment` (edit, or the comment
  role) gates the comment box, Reply and `boardsAddComment`; Resolve stays
  an editor's. The top bar shows **View only** / **Can comment**.
- **Roles only mean something on a PRIVATE board** — a TEAM board is
  editable by everyone (Stage 6), and the share sheet says so.
- **A HOLE CLOSED:** before this, anyone on `sharedWith` could rewrite
  `sharedWith` (add anyone) and even `ownerUid`, because the update rule
  never looked at which fields changed. Sharing fields (`sharedWith`,
  `sharedView`, `sharedComment`, `ownerUid`) are now the board owner's or an
  app owner's (`boardSharingUntouched()`); the share sheet opens only for
  them (`_boardsCanManageShare`). **Visibility is deliberately NOT in that
  list** — any editor can still flip TEAM/PRIVATE, as before; recorded, not
  changed.
- Rules: `boardSharedEditor` / `boardSharedCommenter` / `canEditBoard`;
  comments and the activity feed accept a commenter (`canCommentParent`),
  trash and comment updates stay editors'.
- **Verified in the real emulator** (`tests/rules-emulator-boards.js`,
  26/26, share payload built by the app): against the PREVIOUS rules 12
  fail, including the escalation and the ownership takeover. Client half:
  `tests/board-roles.test.js` (27) — reverted role check (7 fail), compose
  gate (1), share-sheet gate (1). Layout: `boards — the share sheet with
  roles`, which caught a long name pushing the @username out of the row
  (the name wraps now). **It cannot measure the role dropdown's own text**
  (the probe skips `<option>`) — checked by breaking it.
- **Nobody has used a role on a real screen** — the sandbox cannot sign in [29 Sept: a headless QA session can sign in and render — see "Sandbox limits"].

### Mood Boards — notifications to the bell (Sept 2026)

The fourth Milanote gap (help centre, search summaries). Board events go to
the **same bell** as everything else — `hrm_notifications`, `forUser` =
USERNAME, deterministic ids, `source:'moodboards'` — so no new panel, badge
or rules change. The Board's inbox filters on its own `source` client-side
too, so these never appear there.

- **A comment** tells the board's owner, everyone who already wrote in that
  thread (a card's, or the whole-board one) and the author being replied to
  (as "X replied to you"). Never the writer. **Only people who can READ the
  board** (`_boardsCanReadAs`, the read rule from the client) — a private
  board's comment text must not land in someone else's bell. App owners are
  NOT readers of a private board ("private means private"), so they are not
  told. Recipients: `_boardsCommentRecipients` (pure). Comments now store
  `byU` (the username); older ones are traced by display name.
- **Assigning a task** tells the assignee (not yourself, not someone who
  cannot open the board, not a re-assignment to the same person). The
  assignee is a USER_DEFS NAME (`it.who`), mapped to a username.
- **Due reminders** (today or overdue, not done) are raised by the
  ASSIGNEE's own device once a day when the board list loads
  (`_boardsRaiseDueReminders`, the Marketing M5 pattern), written only if
  absent so a dismissed one stays dismissed that day. **Nothing fires while
  nobody opens Mood Boards**, and the bell itself is read on HRM load, not
  live — both pre-existing shapes, not changed here.
- **The bell renders title and message RAW**, so `_boardsNotifRow` escapes
  both. **"View" opens the board on the card**: `actionUrl` is a
  `#board=…&card=…` deep link; `js/shared.js` `_hrmNotifAction` (cross-track,
  one additive branch) hands a `#…` url to `location.hash`. Ids are cut to
  `[A-Za-z0-9_-]` because the url is interpolated into an onclick.
- A notification that fails to write never fails the comment or assignment.
- **Not built:** @mentions (their own gap), email, "changed since your last
  visit". `tests/board-notify.test.js` (27): reverting the reader filter
  (2 fail), the escaping (2) and the only-if-absent check (1).

### Mood Boards — video in a link card (Sept 2026)

The first gap built from the **Claude in Chrome study** — five GitHub issues
filed 28 Sept 2026 (#92 getting content in, #93 moving and copying, #94 new
card types, #95 trash and templates, #96 sharing and notifications), each
fact labelled SEEN / MEASURED / HELP / UNKNOWN. **Read the matching issue
before building any remaining Milanote gap.** The study's own limits: it
could only do atomic drags (so no hover-to-open timings or drop cues), had
no second user, phone or extension, and attached no screenshots.

From #94 §12: **a YouTube link is not a separate card type — it is the link
card with its preview turned into a player.** A 16:9 black area, the
thumbnail, a centred 56px `rgba(0,0,0,.6)` ▶ circle; clicking ▶ swaps in the
provider's iframe with autoplay and it plays INLINE with the provider's
controls. The existing preview toggle hides and shows it.

- **`_boardsVideoOf(url)` is the one decision, pure:** youtube.com (www./m.)
  watch / shorts / embed / live, youtu.be, vimeo.com/<digits>[/<hash>], a
  `t=`/`start=` time carried. The HOST is matched exactly
  (`youtube.com.evil.test` is not YouTube) and the id is re-validated
  against the provider's shape before it goes into a URL.
- **Nothing loads from YouTube until ▶** — no player and no tracker per
  video on open — and the embed is `youtube-nocookie.com`. The thumbnail is
  the fetched (Cloudinary-mirrored) preview picture, else YouTube's own
  `i.ytimg.com` still; Vimeo has no id-based still and shows black until
  the preview fetch lands.
- **▶ swaps ONE element** (`window.boardsVideoPlay`). Playing is per viewer
  and per visit (`_boardsPlaying`, reset on board open), never stored.
  **KNOWN LIMIT: a full re-render restarts a playing video** — Milanote keeps
  its iframe mounted; moving an iframe in the DOM reloads it, so matching
  that would mean never rebuilding the card.
- A video card is born **340 × 300** (`_BOARDS_VIDEO_W/H`; Milanote 338 wide
  with a 338×189 media area), sized immediately rather than after the fetch,
  and only while still at its birth size.
- **Not built:** uploaded video files (autoplay/loop are for uploads only in
  Milanote — HELP), the separate "Link info" toggle, and audio / map cards
  (their own gaps, specified in #94 §13–14). **Vimeo is unverified** — the
  study did not try it; built from the documented embed URL.
- `tests/board-video.test.js` (27). Layout fragment `boards — a video link
  card` (over a white stand-in thumbnail): making the play button
  unclickable fails it; shrinking the card does NOT (the video area yields
  its height, which is correct).
- **Nobody has pressed ▶ on a real screen** — the sandbox cannot sign in [29 Sept: a headless QA session can sign in and render — see "Sandbox limits"].

### Mood Boards — audio and map in a link card (Sept 2026)

#94 §13–14, the same idea as video: the link card's preview area becomes the
provider's player. `_boardsEmbedOf(url)` (pure) is now THE decision —
video (via `_boardsVideoOf`), audio, map — and `_boardsEmbedSize` the one
birth size (340 wide; a player's own height + `_BOARDS_EMBED_META_H` 110).

- **Spotify** (track / album / playlist / episode / show / artist, 22-char
  id, `intl-xx/` prefix allowed) renders its LIVE embed immediately — what
  Milanote does — 80px for a track, 152 otherwise, `loading="lazy"`.
  **This deliberately differs from video**, which waits for ▶.
- **SoundCloud** (`soundcloud.com/<user>/<track>`, system pages refused) is
  artwork + ▶, then the 145px "visual" player with auto_play.
- **Google Maps** (`google.com/maps` place / search / `@lat,lng,Nz` /
  `?q=`, and `maps.google.com`) is a LIVE map; the wheel zooms the map, not
  the board, because the event goes to the iframe's document (as SEEN).
  **Milanote uses the Maps Embed API, which needs a key we do not have;
  ours is the keyless `maps.google.com/maps?q=…&z=…&output=embed` — long-
  standing but NOT a documented API, unverified.** If maps come up blank,
  that is the first thing to check (the fix is a key + the Embed API).
  Short links (`maps.app.goo.gl`) stay ordinary links.
- **A fixed-height player sets the card's floor** (`_boardsMinCardH`:
  player + link info), because the layout fragment showed a shorter card
  pushing the title out; the render grows an old card, nothing migrates.
- Tests: `tests/board-video.test.js` (45 now); layout fragment `boards —
  video, audio and map link cards` (1900 only — five 340px cards in a row),
  which names the title when a Spotify card is squeezed.
- **Nobody has seen these on a real screen.** Spotify, SoundCloud and Maps
  are all unreachable from the sandbox.

### Mood Boards — Tab stays in the note (28 Sept 2026)

GitHub #97 (Afnan's own side-by-side test against Milanote), bug 1:
**Tab in a note moved focus out of the card and whatever was typed next
was lost** (or fired a board shortcut). A note body had no key handling at
all, so the browser did its default. `_boardsNoteTab` is read in
`_boardsOnKeydown` BEFORE the editable bail (the note IS the editable),
only while `_boardsEditingEl` is a `board-txt-*` field and never with
Ctrl/Cmd/Alt: in a list item it runs the browser's `indent`/`outdent`
(a nested `<ul>`/`<ol>`, which the sanitiser already keeps); anywhere
else Tab inserts four no-break spaces (a `\t` collapses — the body is not
`white-space:pre`, and making it so would change how every existing note
renders); in a heading it is simply kept. A to-do keeps its own Tab
(indent a task). `tests/board-notetab.test.js`. **Nobody has pressed Tab
in a note on a real screen yet.**

**Present kept a note's structure (#97 bug 3, same day).** A note slide
drew `c.text` — the note with every line, list and colour stripped — so it
read "test- bullet one1. numbered…". A note carrying `c.rich` now draws it
as `.bp-body.rich`, through **`_boardsSanitizeRich`, the same boundary the
canvas uses** before stored markup touches the live DOM (never `c.rich`
raw), with em-sized list/heading/code/quote rules so it scales with the
slide. Checked in real Chromium: nested lists and a colour survive, an
`<img onerror>` and a `<script>` are stripped and do not run.
`tests/board-present.test.js`. **Known edge, not changed:** a note whose
only line breaks are Shift+Enter `<br>`s counts as "plain", so it is
stored as `c.text` alone and loses those breaks on the canvas too.

**A board tile counts its Unsorted (#97 bug 4, same day).** After "Move to
board…", LAB A's tile still read "0 cards" — true of its canvas, but the
card had landed in its Unsorted, so the move looked like it had failed.
The sub-board card and the Home panel row now add "· N in Unsorted"
(`_boardsUnsortedCount`: tray ITEMS, one per row, however many cards a
stashed column carries). The move already mirrors the target's `unsorted`
into `moodBoards`, so the tile updates the moment the move lands. Guarded
in `tests/board-move.test.js`.

**The board picker stopped jumping (#97 bug 5, same day).** `.board-sheet`
is bottom-anchored and sized to its content, so a search that shortened the
"Move to a board" list shrank the sheet and dropped its top edge — MEASURED
in real Chromium at **182 → 499** after one search. `.board-sendto-list`
has a FIXED `height:min(52vh,420px)` now (was `max-height`): 182 → 182,
and 218 → 218 on a 360px phone. The same report had it "partly under the
new-version banner": that banner (`js/shared.js`, fixed, bottom:0,
z-index 2000) measures **53px** on desktop and **83px** at 360 (it wraps),
so `body:has(#sw-update-banner) .board-sheet:not(.board-pop)` lifts every
bottom sheet onto it (71px / 83px). The share-into picker uses the same
list and gets both. Held in `tests/board-move.test.js` (the probe cannot
type into a search).

**A note's hover strip is a corner chip (#97 bug 6, same day).** The
full-width dark "NOTE ✕" scrim sat on the first line and the placeholder, so
hovering a note to read it hid what you came to read. On `.type-text` the
head is now a small chip in the top-right (the ✕; the lock on a locked
note; the name only while it is being renamed — it is renamed from the
rail, F2 or the menu, never by clicking the strip), and the body carries a
`::before` float on its FIRST LINE (`.board-text-body:not(:empty)`) the chip
sits in, at rest too, so hovering never reflows the note. A comment pin
steps left of the chip while it shows. MEASURED in real Chromium: no text
rect meets the chip on a plain, an empty and a list note; removing either
rule brings the overlap back. Other card types keep the strip. Held in
`tests/board-notetab.test.js` (the probe cannot hover).

**A note grows with its text (#97 bug 7, same day).** It kept a fixed
height and scrolled inside at ~100px. `_boardsFitNotes` (end of
`_boardsHydrateTextCards`) DRAWS an overflowing note to its text at render
without writing `c.h` — no write on a read path, nothing migrates — and
skips a column child, which the column lays out from `c.h`; typing
(`boardsTextInput` → `_boardsFitNote(c,true)`) grows `c.h` itself, so the
connectors, frame membership and the column follow. Grow-only; the resize
clamps a note at its text; capped at `_BOARDS_NOTE_MAX_H` (3000), past which
it scrolls. MEASURED in real Chromium: a 100px note holding 200px of text
is drawn at 200 with `c.h` still 100, and typing grew one to 380;
removing the render pass puts the 100px of overflow back.
`tests/board-notegrow.test.js`.

**The Report Bug button left the board, and Find clears the side panels
(#97 bug 8, same day).** On desktop the fixed `#bug-report-fab` (z 500)
sat on the comment drawer's Post button. It is now hidden while
`body.board-fullscreen` at EVERY width (it was phone-only), and the ⋯
menu offers "Report a bug" at every width. Find lives in the stage at z 28
while the comment drawer (z 32, 320px) and the Unsorted tray (z 130,
380px) are its right-hand siblings, so it opened behind them; on desktop
it now steps left of whichever is open (`.board-below:has(...)`, not on
Home, whose panel insets the stage). MEASURED in real Chromium: Find at
right 334 with the drawer open and 394 with the tray, hit-testable both
times; with the rules removed it sits at 14 and is covered. The old
assertion "desktop has no Report a bug" in `tests/boards.test.js` was
reversed, not deleted.

**A reload comes back to the board (#97 bug 9, same day).** Nothing but
a pasted link ever put a board in the URL, so "Refresh now" landed on the
app's first page. `_boardsSetHash` writes `#board=<id>` when
`_boardsOpenCanvas` opens a board (Home too — it opens through the same
path) and clears it when the `showPage` wrap leaves the canvas or the board
is not found; the existing `_boardsConsumeDeepLink` after `startApp` does
the rest, behind the same Creative Hub gate. **`replaceState`, never a new
history entry**, so Back is unchanged and no `hashchange` fires to re-run
the consumer; only a `#board=` hash is ever cleared. `tests/board-hash.test.js`.
**Not verified end to end** — the sandbox cannot sign in [29 Sept: a headless QA session can sign in and render — see "Sandbox limits"], so a real reload
landing back on a board has not been seen.

**Renaming a board in the top bar: Enter saves (#97 bug 10, same day).**
Enter did nothing — the rename sat in the 900ms debounce with the caret still
in the box — and the breadcrumb tile kept the old name's first letter. The
title input now has `onkeydown` (`boardsTitleKey`: Enter blurs, Escape puts
back the name it had on focus), and `onblur` (`boardsTitleDone`) trims, saves
at once, mirrors `moodBoards` and repaints `#board-crumb-tile`.
`tests/board-title.test.js`.

**Drag a card onto another board to move it (#97 bug 2, same day).**
Dropping a card on a sub-board card, or on a breadcrumb above this board,
moves it into that board's Unsorted through `window.boardsMoveCardsTo` —
the menu's own implementation, so its refusals and transaction are shared.
Targets are fixed at grab time (`_boardsMoveDragTargets`: live, editable,
not Home, not this board; breadcrumbs carry `data-board-drop`) and light up
with `.board-move-drop` while held. The cards go back to where the gesture
started and the drag's undo entry is popped before the move. A group
holding a board link is refused whole. **Hover-to-open is NOT built** — no
measured delay, and the drop already reaches the board.
`tests/board-dragmove.test.js`. Nobody has dragged onto a board on a real
screen.

**EVERY card wears the corner chip now, not only a note (same day).**
Afnan: the black hover strip was still on images, to-dos and "everything"
else. The bug-6 rules dropped `.type-text` and apply to `.board-card-el>
.board-card-head`: a small ✕ chip top-right, the type word hidden, the name
only while being renamed. Only a note keeps the first-line float. Board
layout probe 152/152 and phone probe 30/30 pass; nobody has hovered one on
a real screen.

**Zoomed out, a card's content stays visible (same day).** Afnan, with a
screenshot of blank white cards at far zoom. The far level of detail used to
hide note, to-do and link text, captions and a sub-board's meta and
thumbnails; they stay painted now and only the chrome goes. The far-zoom
probe's chrome list dropped `.board-caption` to match.

**Alignment is motion-driven, and the guide lines are gone (same day).**
Afnan, with a screen recording: the snap lines "are shit". A card drag no
longer draws guides; `_boardsAlignPull` scales the pull toward a
neighbour's edge by the smoothed pointer speed — full below 0.12 px/ms,
none above 0.6, a straight fade between — so a fast drag follows the finger
exactly and a slow settle aligns. Snap-to-grid and Alt are unchanged.
Nobody has felt it on a real screen.

**The dot grid is always on, and alignment eases (same day).** At
Afnan's ask the dots paint on `.board-stage` at rest (REVERSES the second-
video "placement cue only" rule; `_boardsFlashGrid` still toggles
`grid-on`, which now changes nothing). The alignment offset glides 30% of
the way to its target on each move instead of jumping.

**The drag is Milanote's now — lift and tilt, no alignment (same day).**
Afnan sent Milanote's drag beside ours. Read off its frames (contact sheet,
cv2): the held card LIFTS (deeper shadow, slightly larger) and TILTS a few
degrees toward where it is moving, then settles flat; no guide lines, no
snapping. Ours: `.board-card-el.lifted` with `--tilt` written by the drag
from eased horizontal speed (capped ±5°), and **no pull toward neighbours
at all** (the velocity-gated pull above is gone from the drag;
`_boardsAlignPull` is left unused). Grid snap still works when switched on.
Also: **Space or the Hand pans over a card** instead of grabbing it (the
stage takes the press, the card drag bails for a mouse), and **removing an
Unsorted item asks nothing** — it pushes undo, since the snapshot carries
the tray. Nobody has felt the drag on a real screen.

**A click no longer brings back the last selection box (29 Sept).**
Afnan's recording: after a marquee, a plain click on the board flashed the
OLD box. The press showed `#board-marquee` with the previous gesture's
size and place until the pointer moved. It is zeroed on the press, shown
only past 3px of movement, reset on release, and a `pointercancel` ends the
gesture too. Held in `tests/boards.test.js` ("a click does not bring the
last selection box back") — verified by restoring the old show-on-press. **Hardened again the same day** after
Afnan said it still happened: a `pointermove` with no button held
(`ev.buttons===0`, i.e. the release was lost off the window) now ends the
gesture instead of drawing the box from the old start point, and a
right-click (`e.button===2`) starts neither a box nor a pan. Both held in the
same test section, and both fail by name when undone. **If it is reported
again, first check the build is v249+** — v248 had only just deployed.

**#97 also reports things `main` already has** (Draw on, body drag, a
YouTube player), so that test may have run on an older build — the
Netlify deploy list or the diagnostics build id settles it; do not
re-diagnose those from the code.

### Mood Boards — the colour swatch (28 Sept 2026)

Milanote's colour card, built from what a screen recording showed. **Type
a hex colour (`#RGB` or `#RRGGBB`, `#` required, nothing else in the note)
and leave the note: it BECOMES a swatch** in place (`type:'swatch'`,
`hex` normalised to 6-digit upper case, 220×230), through
`_boardsSwatchFromNoteEl` in `_boardsEndEdit`, which pushes undo first —
Ctrl+Z gives the note back. The add rail is unchanged; the note is the only
way in, as in Milanote.

- **One stored field, `c.hex`, always through `_boardsValidHex`.** The value
  string, the ink on the block (`_boardsInkOn` — a literal ink on a literal
  colour) and the NAME are derived at render. `c.fmt` stores only the
  exception (`rgb`/`hsl`/`off`; no field = HEX), the Marketing-style rule.
- **The name is the nearest of ~250 curated names** (`_BOARDS_COLOR_NAMES`:
  the CSS set plus textile words — Mocha, Aqua Forest, Outrageous Orange…)
  by squared RGB distance. Nothing fetched. `c.name` (Caption edits the name
  bar in place; Rename in ⋯ writes the same field) wins over it; typing the
  auto name back clears the field.
- **The name bar is `var(--dark)` / `var(--on-dark)`** — the pair inverts
  together, so it reads in both themes.
- **Rail: Color · Labels · Reactions · Comment · Display · Caption · ⋯.**
  Display is a `.board-ctx` of four tabs with `{keep:true}`. Color on the
  rail, or a DOUBLE-click on the block, opens the picker (29 Sept 2026 —
  it used to open on a click of an already-selected swatch, and since the
  card's own pointerdown selects it, a single click opened it): an SV square, a hue slider, a preview dot, an
  eyedropper (`window.EyeDropper`, hidden where absent — Chrome/Edge only)
  and fields cycling RGB → HSL → HEX. It is `_boardsOpenSheet` anchored to
  the card (a bottom sheet on a phone). **One undo entry per picker
  session** (`_boardsSwPick.pushed`); every change repaints the one card
  (`_boardsSwatchPaint`), never the canvas. `_boardsSwatchSetHex` is the only
  writer after birth and refuses what `_boardsValidHex` refuses. The picker
  is new code, not the board tile's HSV sliders — those have no SV square.
- The export draws the block, the value and a literal dark name bar; search
  finds the hex and the name; the noun and header label say Colour.
- `tests/board-swatch.test.js` (49) drives the end-edit conversion, undo,
  names, formats, the Display switch, the rail, the picker's fields and the
  escaping. Verified by reverting: the undo push (3 fail), the setter's
  validation (4), the one-undo-per-session flag (1). The layout fragment
  `boards — colour swatches` (both themes) fails 4 jobs with the name bar's
  ink set to its own background.
- **Not built:** Milanote's other routes into a swatch (none were in the
  recording). **Nobody has seen a swatch or the picker on a real screen** —
  the sandbox cannot sign in [29 Sept: a headless QA session can sign in and render — see "Sandbox limits"]; the SV drag and the eyedropper are untested.

**Pantone codes on a swatch (same day).** Afnan: TCX (fabric) and C
(coated) conversion "to the same color logic". A note reading `485 C`,
`Pantone 485 C` or `19-1664 TCX` (dash, spacing and a Pantone/PMS prefix
optional; TPX/TPG/U read too) becomes a swatch of that colour showing the
code (`c.pantone`, `fmt:'pantone'`). The Display menu gained a Pantone mode:
any swatch shows its nearest code, marked `≈` when not exact.
**The book is only what the app holds** (`_boardsPantoneBook`): the ~55 C
codes built into `js/embellishments.js` (`COLOR_IMPORT_PANTONE_HEX`) plus the
embellishments colour library (`color_library`: `pantoneCode` + `hexApprox`,
archived and invalid entries skipped), read once per session on board open
(`_boardsPantoneEnsure`, never rejects). **There is no TCX data except what
the library holds**, and the full books are licensed and unreachable from
the sandbox — an unknown code stays a note, nothing is invented. A file from
Afnan would go into `_BOARDS_PANTONE_EXTRA`. `tests/board-swatch.test.js`.

### Mood Boards — Pick colour, and the TCX / Pantone C tabs (29 Sept 2026)

Afnan: *"a tab for TCX code and pantone code — we click on an image and it
gives which code it is"*.

- **Pick colour** is on an image card's rail (and its right-click menu, so
  the phone's More sheet reaches it; ⋯ does not repeat it). With it on
  (`_boardsPickOn`, a dashed outline and a crosshair), a press on the
  picture READS instead of dragging: `boardsCardDragStart` hands it to
  `_boardsPickAt`, which redraws the picture exactly as the card shows it
  (`_boardsDrawPicture` — the same `_boardsImgGeom` for a crop or turn,
  else the card's cover/contain fit) into a card-sized canvas and averages a
  5×5 patch (`_boardsAvgPixels`, transparent pixels skipped — one pixel of
  a fabric photo is a thread). A picture whose host blocks CORS taints the
  canvas; that is SAID, never guessed. Off by Escape, by selecting anything
  else, and on board open. A viewer can read; only an editor gets Swatch.
- **The panel** (`_boardsPickShow`, a sheet anchored at the click) shows the
  colour and two tabs, **TCX · fabric** and **Pantone C**, each listing the
  three closest codes of THAT book only (`_boardsPantoneSys`: TPX/TPG/U are
  in neither). The tab is per viewer (`groovy-boards-picksys`). A match or
  "this exact colour" becomes a swatch BESIDE the picture, stacked under
  any already there, one undo each. **The swatch's own Colour picker got
  the same tabs** (`_boardsNearHTML(hex,'sw')`), where a match is applied to
  the swatch. Buttons carry an index into `_boardsNearLast`, never a code.
- **Closeness is CIEDE2000 on CIELAB** (`_boardsLab`, `_boardsDE2000`),
  asserted against five published reference pairs (Sharma, Wu & Dalal
  2005), with words (Exact < 1 · Very close < 3 · Close < 6 · Rough < 12 ·
  Far off). `_boardsPantoneNearest` (the Display › Pantone "≈") uses the
  same measure now; it was RGB distance.
- **An empty book says so**: with no TCX codes loaded the TCX tab says the
  book has not been added, never a C code under a TCX heading. Today the
  TCX tab only knows TCX codes in the Color Library — the full book is the
  2,310-colour file, waiting on Afnan and its licence.
- Fixed with it: **"Cool Gray" never matched** — `_boardsPantoneKey` only
  read GREY, while Pantone's books write GRAY; both reduce to GRAY now. And
  **a recoloured swatch kept its old code**: `_boardsSwatchSetHex` drops
  `c.pantone` unless the new colour is that code's own.
- `tests/board-colourpick.test.js` (40) drives the pick through a stub
  canvas; verified by undoing the book filter, the press intercept, the
  stale-code fix and ΔE2000 (swapped for Lab distance) — each fails by name.
  `smoke-layout` fragment `boards — Pick colour and the TCX / C tabs`
  (both tabs and the empty TCX tab) fails at 1:1 with a code's ink broken.
  Looked at in Chromium, both themes. **Nobody has picked a colour off a
  real photo** — the sandbox cannot sign in [29 Sept: a headless QA session can sign in and render — see "Sandbox limits"], and the CORS answer of the
  live Cloudinary pictures is the thing to watch.
- **Shipped at v252, not v251**: Ammar's PR #91 landed on `main` at v251
  while this branch also sat at v251 — the identical-number collision this
  file warns about. Merged, bumped past both.

### Color Library ▸ TCX codes, and Pick colour's Swatch (29 Sept 2026)

Afnan supplied `Pantone_TCX_Color_Collection.xlsx` (2,800 colours: code,
name, hex) — the TCX book the Pick colour tab was waiting on.

- **It ships as a static file, `assets/data/pantone-tcx.json`** (`{source,
  count, colors:[[code,name,hex],…]}`, ~99 KB, in `PRECACHE_URLS`), converted
  with the vendored SheetJS; every row validated (code `NN-NNNN`, hex
  `#RRGGBB`, unique). **Not copied into `color_library`** — 2,800 documents
  nobody edits would be writes and a rules change for a reference book. No
  `firestore.rules` change. **Licence: supplied by Afnan for this use.**
- **Color Library has two tabs**, Library | TCX codes (`_colorLibTab`, per
  viewer in `localStorage`, `js/embellishments.js` — Ammar's file, tell him).
  The TCX tab (`_tcxLoad`, `_tcxParse`, `_tcxMatches`, `_tcxListHTML`)
  searches code (with or without the dash), name, or a `#hex` (a leading
  `#` is colour-only), shows 120 rows then Show more, marks a code already
  in the library (archived ones do not count), and **+ Add** opens the
  ordinary Add Color form prefilled with name, `NN-NNNN TCX` and hex. Names
  escaped; a failed read says so with Retry.
- **Mood Boards reads the same file** (`_boardsTcxEnsure`/`_boardsTcxApply`,
  once per session, into `_BOARDS_PANTONE_EXTRA` as `NN-NNNN TCX`, names in
  `_boardsTcxNames`), so the Pick colour TCX tab and a note typed as a TCX
  code both know all 2,800. An empty TCX tab now says Loading / could not
  load, never "not added".
- **"Swatch / Make a swatch of this exact colour" did work — under the
  panel.** Reproduced in real Chromium on the stub site: the swatch was made
  beside the picture, exactly where the popover sits, and the popover stayed
  open. It now closes the panel, pans the least distance to bring the swatch
  on screen (`_boardsRevealCard`) and flashes it; pick mode stays on.
- **A swatch opens its picker on double-click only** — see the swatch
  section above.
- Tests: `tests/color-tcx.test.js` (20, the real file), +14 in
  `tests/board-colourpick.test.js`, +2 in `tests/board-swatch.test.js`; layout
  fragment `color library — the TCX codes tab` (fails 6 jobs with the code
  ink broken). Undone to check: the panel close (fails by name), the archived
  filter (fails by name). **Nobody has used the tab on a real screen.**

### Color Library ▸ Pantone C codes; Milanote opens on Mood Boards (29 Sept 2026)

- **A third tab, Pantone C codes**, beside Library | TCX codes
  (`_colorLibTab` `'c'`, `_pcBook`/`_pcMatches`/`_pcListHTML`,
  `js/embellishments.js` — Ammar's file, tell him). **There is no C book
  file**, so the list is DERIVED on every render: the importer's built-in
  `COLOR_IMPORT_PANTONE_HEX` (~55 C codes; White/Black/Base left out) plus
  every ACTIVE library colour whose code ends in " C" (GRAY read as GREY,
  deduped). It says on screen that the full book is not loaded. Plain
  numbers sort first, named ones after. **+ Add** carries an index into the
  filtered list, never a code, in its onclick. A full C book sent as a file
  (like the TCX xlsx) would go in `assets/data/pantone-c.json` and replace
  the built-in half. `tests/color-tcx.test.js` (+19), layout fragment
  `color library — the Pantone C codes tab`.
- **Milanote opens straight on Mood Boards** (Afnan: Notes, SOPs, Storage
  and Chat are not in use). `showPage` (`js/shared.js`, cross-track, one
  line) rewrites `creative-hub` to `boards` AFTER the role scopes, and
  lights `nav-creative-hub` for every Milanote page — so all eleven routes
  and every role grant still work, unchanged. The hub page and
  `renderCreativeHub` still exist, unreachable. Home's back button leaves
  to the **Dashboard** (it went to the hub, which would now loop back to
  Home); **Notes** is on Home's ⋯ menu, and its back button returns to
  Mood Boards. Four tests that expected the hub were updated to the new
  answer.

### Mood Boards — Unsorted previews, and the magnet (29 Sept 2026)

Afnan: dropping a card into Unsorted should have "a magnet like effect,
pull and push to grab things", and the tray should PREVIEW what it holds —
a column its title and how many cards, a to-do its tasks.

- **Previews** (`_boardsTrayPreview`, one function for markup AND text):
  a note shows its lines, a to-do its title, done/total and the first four
  tasks ticked or not (+N more), a column or frame its title, its card count
  and the first three cards (a picture, a colour chip or a type letter, then
  the name), a colour paints itself with its code and name, a heading is a
  dark banner, a table its first cells. A photo, link and PDF keep the
  picture `_boardsTrayFace` already gave them. **Every string goes in
  through `_boardsTrayHydrate` with `textContent`**; a swatch hex is
  validated before it reaches a `style`. Derived from the stashed card, so
  nothing is stored and old items preview too. The drag ghost of a colour
  carries the colour. Fixed in passing: `_boardsStashName` read a to-do's
  first task from `.t`, but items are `{text,done}`, so a to-do row said
  "To-do".
- **160px, measured:** two title lines + four tasks + "+N more" fit;
  five tasks pushed "+N more" out of the box (the probe named it).
- **The magnet** (`_boardsMagnet`, pure; `_BOARDS_MAGNET_PX` 170,
  `_BOARDS_MAGNET_CATCH` 56): within 170px of the open tray or the peek zone
  the held card is pulled toward it, harder the closer (`--mx/--my/--ms` on
  `.lifted`, which springs back through the existing transition when pulled
  away) and the target glows (`--mag`); within 56px it is CAUGHT — shrinks
  to 45% under the pointer, outlined, a buzz on Android — and a drop there
  stashes. **The highlight and the drop read the same answer**, and the pull
  is visual only: `c.x/c.y` are never bent, so a drop on the canvas lands
  under the pointer. On the drop a clone (ids stripped) flies into the panel
  and the new row pops in (`_boardsTrayLanded`, one-shot); nothing moves
  under `prefers-reduced-motion`.
- `tests/harness.js`'s element `style` gained `setProperty` /
  `getPropertyValue` / `removeProperty` — without them the pull was skipped
  and could not be asserted. Verified by undoing: catch radius 0 (a drop
  40px short stops being caught), the pull zeroed, the `.text` fix.
  **Nobody has felt the magnet on a real screen** — the sandbox cannot sign
  in [29 Sept: a headless QA session can sign in and render — see "Sandbox limits"]; the previews were rendered and looked at in Chromium, both themes.

### Mood Boards — a link with no picture (29 Sept 2026)

Afnan, with a Pinterest pin in Unsorted as a grey LINK box and the same pin
on the board as a card titled "pinterest.com" with no picture: *"there
should be a preview of the link as well in unsorted and on board as well"*.

- **The server tries oEmbed when the page gives no picture**
  (`netlify/functions/link-preview.js`: `preview`, `oembedEndpoint`,
  `fromOembed`). Endpoint: a Pinterest `/pin/` URL maps to
  `https://www.pinterest.com/oembed.json?url=…`; any other page's own
  `<link type="application/json+oembed">` is used. The call goes through
  `fetchHtml` (json mode), so the endpoint's host is resolved and checked
  and every redirect re-validated. A non-JSON answer is ignored, the picture
  goes through `safeImageUrl`, and a failure leaves the page's answer
  standing. A page title that is only the host or the provider's own name
  ("Pinterest") gives way to oEmbed's title; a real title is kept.
  **The Pinterest part is a hypothesis, not verified:** pinterest.com is
  unreachable from the sandbox, so neither the empty bot page nor the
  endpoint's answer has been seen. The first real paste is the test.
- **A pictureless link in Unsorted previews as the link** (site, title,
  description, address — `_boardsTrayPreview`'s first branch, hydrated
  with `textContent`), not a grey box. One with a picture keeps it.
- **A link dragged out of Unsorted with no picture is fetched again**
  (`_boardsLinkHydrate` in the tray drag's `up()`); one that brought its
  picture is not. A card already on a board gets it through right-click →
  **Refresh preview**, which already existed. No write happens on open.
- `tests/link-preview.test.js` (+21), `tests/board-trayprev.test.js` (+11);
  reverting the drag-out re-fetch fails 3, turning off the oEmbed step
  fails 10, and painting the site line in `--surface` fails the tray layout
  fragment at 1:1.

### Mood Boards — the phone audit (Sept 2026)

Afnan: *"Study phone ui as a whole and find bugs in them go all in"*, then
*"Push the fixes … make sure everything in phone ui is crossed checked,
every function, every motion, every logic."* Fourteen findings; everything
below was either MEASURED in headless Chromium at 390×844, 390×667 and
360×780 or read from the code, and every fix was verified by reverting it.

**How it was measured, and the trap in it.** The existing `smoke-layout`
probe measures FRAGMENTS in a padded `#main-content` at 420px — it had never
seen the board canvas as a phone does: a `position:fixed` takeover with a
top bar, a docked rail, a panel, the bug FAB and two dropdowns all
competing for one screen. So the whole canvas was composed and measured,
and that is `tests/smoke-phone.js` now (9 variants × 3 viewports, in CI).
**The first run was worthless: headless Chromium clamps `--window-size` to
500px wide**, so a "390px" run silently measured a tablet with the phone
CSS applied. The page is rendered inside an `<iframe>` of the real width
instead (media queries, `position:fixed` and `100dvh` all resolve against
the iframe's viewport) and the probe posts its result to the parent, which
is what `--dump-dom` returns. Check `r.vw` against the requested width —
the runner does.

**What was broken, and what holds each fix:**

- **Both top-bar menus rendered 80px off the LEFT edge.** `.board-menu` was
  `position:absolute;right:0` inside a wrap that lands at the END of a
  wrapped flex row ~144px wide: the ⋯ menu at **x −81..144**, View at
  **−83..97**, and the ⋯ menu 526px tall with no scroll. View is the only
  route to zoom/Fit/Snap on a phone. They dock as bottom sheets now, the
  `.board-ctx` pattern — the one popover in the module that had been missed.
- **Half the rail was off-screen with nothing to say so.** Twelve tools =
  698px in a 368px scroller; Image, File, Comment, Fit, More and **Trash**
  needed a sideways scroll nobody was told about — the trash badge ramp and
  shake never appeared on a phone. The add-mode rail on a phone is now
  **Note · Image · File · Board · More · Trash** (`_BOARDS_RAIL_PHONE`), the
  shape the selection rail already had, with everything else behind More
  (`_boardsRailPhoneOverflow`, asserted to lose nothing and repeat nothing).
- **The top bar was 142px tall** — 21% of a 667px screen — from seven
  controls wrapping. It is ONE row (55px): back · title · Boards/Unsorted ·
  zoom% · ⋯, with Undo, Redo, Find and Comments in the ⋯ sheet **under the
  same ids**, so `_boardsSyncHistoryButtons` needed no change. Breadcrumbs
  and the visibility pill are dropped on a phone; the save status stays
  (it only ever shows a failure).
- **The bug FAB sat on the rail's last tool and floated over the open
  panels** (z-index 500, fixed) — the collision that retired the minimap.
  Hidden while `body.board-fullscreen`; "Report a bug" is in the ⋯ sheet.
- **Home's collapsed panel bar covered the bottom 32px of every rail
  button** (bottom-anchored, z 130 over z 26). It sits above the rail now.
- **The Open pill sat exactly on the sub-board card's resize grip** — a
  phone-only bug by construction, since the pill exists only under
  `_boardsIsPhone()`. Moved 44px left.
- **The bottom chrome is one stack off ONE number now** — the rail's top
  edge — and every piece adds `env(safe-area-inset-bottom)`, which the rail
  itself never did while the fmt bar and the sheets already did: in
  standalone mode on an iPhone it sat in the home-indicator zone.
- **Touch targets under 32px**: the Unsorted item ✕ was 20×20; the back
  button 25px; the panel's Hide/Close/+Team/Place all/All·Team·Private
  26–29px; card ✕ 27px; every menu row 31px. All ≥32 now, and the probe
  measures every chrome control.
- **The empty-board hint was wrong in every clause on a phone** ("Double-
  click … drop files … Ctrl+V … hold Space"). It speaks phone there.

**The four TOUCH behaviours, all found by reading — no probe can drive a
finger — and asserted in `tests/boards.test.js` by driving the recorded
document listeners:**

- **A note could only be edited by `dblclick`, and the module itself had
  ruled dblclick unreliable on touch** — that is why the stage hand-pairs
  taps. Card bodies, to-do items, table cells and headers all still hung
  their edit on the attribute, and the More sheet offered a note no "Edit".
  `_boardsWireTouch` now pairs two taps (300ms, 28px) on ANY `[ondblclick]`
  element and dispatches a synthesized `dblclick` on it — one mechanism for
  every card type, nothing per type. **A browser that does synthesize its
  own dblclick fires it right after the second click, i.e. after ours, so a
  TRUSTED one inside 600ms is dropped at the capture phase** before any
  inline handler sees it: exactly one edit begins either way.
- **There was no long-press at all** — the context menu hung on
  `contextmenu`, which Android fires on a long-press and iOS Safari never
  does for touch. A 500ms hold within 10px now synthesizes `contextmenu` at
  the press point (with a buzz); a trusted `contextmenu` that arrives FIRST
  cancels the timer, and one that arrives within 700ms after ours is
  swallowed — so Android gets one menu, iOS gets one menu.
  `-webkit-touch-callout:none` on the stage keeps the native callout out of
  it; fields keep theirs.
- **The on-screen keyboard panned the board under the caret.** `index.html`
  asks for `interactive-widget=resizes-content`, so the keyboard is a
  `resize`, and `_boardsOnViewportChange` recentred the pan by half the
  keyboard's height — up on open, back on close. It returns early while
  anything is being edited, and leaves `_boardsViewRect` alone too, so the
  closing resize sees no delta.
- **The card drag had no dead zone** — `pushed` went true on the very first
  `pointermove`, so a slightly rolling tap pushed an undo snapshot,
  swallowed the click and moved the card 1–3px (or onto the grid). The rail
  had 5px and the panel/tray drags 4px; the card drag was the odd one out.
  `_BOARDS_DRAG_PX` = 4 now.

**`smoke-layout` lost its three top-bar fragments at 420px, deliberately.**
They render the DESKTOP markup, and the phone CSS now lays the bar out as
one non-wrapping row for the PHONE markup — which is what the real app
renders at that width. A builder may return `{html,widths}` to opt out of a
width; `smoke-phone.js` measures the phone bar instead, and far more
thoroughly.

**What is still NOT verified and only a phone can tell:** whether Chrome on
Afnan's device fires its own `dblclick`/`contextmenu` (either way the
guards give exactly one), the safe-area inset on a real iPhone, and the
keyboard no longer moving a note mid-edit. **Nobody has looked at any of
this on a real screen.**

### Mood Boards — the card is a wide rectangle, and the cue was switched off (Sept 2026)

Two asks in one message: *"when ever a new board is crated i want the
stamderd size to start as a rectanglar share as i made and marked 2, on the
other hand the left side tool bar animation is not working when you hover
over it"*.

**A board card is born 340 × 136, and there is now ONE definition of that
size.** There were two, and that is the part worth keeping: `_boardsNewCard`
minted a board card at **200 × 104** (the rail, the sub-board action) while
Home's grid used **260 × 172** — so the same card came out a different shape
depending on which way you made it, and the render then grew both to the
minimum anyway. Both read `_BOARDS_BOARD_W`/`_BOARDS_BOARD_H` now.

- **136 is MEASURED, not chosen.** Rendered in headless Chromium against the
  real `css/main.css`, the tallest a spine card's body ever gets is **107px**
  — a two-line name, the meta line and a thumbnail strip — so the 28px header
  strip plus `_BOARDS_MIN_BODY_H.board` 108 clears it with nothing clipped.
  That constant came **down from 124** to let the card be this short.
- **It only stays honest because the meta line no longer WRAPS.** While it
  wrapped, a card's natural height depended on how WIDE it was — measured
  107px of body at 260, **122 at 200, 137 at 160** — so the minimum had to
  cover the narrowest card anyone might drag to, which is a different
  question from the shortest a card should be allowed to be. One ellipsized
  line makes the height width-independent, and that is what let the card
  become a rectangle at all.
- **Existing cards are NOT resized on open**, the module's standing rule: an
  old card is drawn at its stored size and grown by the render if it is too
  short. Nothing migrates.

**THE RAIL HOVER CUE WAS SWITCHED OFF BY ITS OWN GUARD.** `@media
(hover:none)` set it `display:none`. Chrome answers that query on the
**PRIMARY pointer**, so a machine with a touch screen matches it *while still
having a mouse*. **Not a hypothesis — the measuring run reports
`hover:none=true` / `hover:hover=false` in headless Chromium on this very
build**, so the cue was `display:none` there too, which is also why no probe
had ever seen it. What it was really guarding is the phone, where the rail is
a horizontal dock and "to the right" means nothing — so it is the module's
own `max-width:560px` breakpoint now, the one `_boardsIsPhone` keys off.
**Reuse the breakpoint, not `(hover:none)`, for anything else that is really
about the phone.**

It was also drawn to be missed: 10 × 2px of `--muted` at .85, travelling 7px,
under a `:hover` that repaints the whole button background at the same
moment. **15 × 3 in the button's own ink now**, re-measured: **x 39–54,
y 13.5–16.5**, against an icon at **x 21–38** and every label at **y 27–39**,
so nothing overlaps where it comes to rest; where it *starts* (x 30–45) it is
behind the icon's right edge and invisible, and sliding out from under it is
the movement being advertised.

**The cue is correctly absent on Image, File and Line** — those three place
nothing, and a cue promising a drag the tool does not accept is worse than no
cue. Three of the rail's tools showing nothing is part of why "not working"
was the report.

**The layout fragment is ONE COLUMN now, and that is not cosmetic.** A 340px
card laid out past the right edge of a **420px** viewport is clipped, and the
hit-test then reports its own controls as covered by whatever it finds at
that point — a false failure of the fragment, not of the layout. It cost two
rows at 260 wide; at 340 it costs a column. Verified both ways: restoring
`board:124` fails "the birth height is not grown by the render" at 152,
dropping it to 100 fails two more by name, and reverting the `_boardsNewCard`
change fails "the same size wherever it is minted" (`340x104`). A too-short
card is caught by the labels/reactions fragment rather than this one — the
spine card's thumbnails are pictures, and the probe measures text.

**Nobody has seen either on a real screen** — the sandbox cannot sign in [29 Sept: a headless QA session can sign in and render — see "Sandbox limits"].

### Mood Boards — the rail's hover cue (Sept 2026)

Afnan: hovering a tool in Milanote's rail runs a small animation, *"such as
line it mover to the right like its inicating the drag and drop process"*.
**Built from that description.** The sandbox cannot reach Milanote, so no
timing here is copied from it and none is claimed to be — the same care the
M6 rail study recorded.

- **It is scoped to `.rail-draggable`, and that is the load-bearing part.**
  The cue advertises a gesture, so a tool that places nothing must never show
  it: a cue promising a drag the tool does not accept is worse than no cue.
- **MEASURED in headless Chromium rather than eyeballed.** Inside a 58px
  button the cue occupies **x 44–54, y 14–16**; every label sits at
  **y 27–39**, so nothing overlaps — including `Comment`, whose label spans
  x 3–55 and **would** have been crossed by a bar on the middle row. That is
  why it sits beside the ICON (~x 20–37) rather than centred. `x1=54` keeps
  it inside the button, so it cannot paint over the canvas.
- `pointer-events:none`, hidden under `(hover:none)` (a phone has no hover
  and the rail there is a horizontal dock, where "to the right" means
  nothing) and its transition dropped under `prefers-reduced-motion`.

**What holds it, and what CANNOT.** `tests/smoke-layout.js` cannot: it cannot
hover, and it enumerates **elements**, not pseudo-elements. A forced
`.cue-on` copy of the rail fragment was tried and **removed** — at 420px the
rail docks to the bottom of its wrapper, so the two copies reported each
other as covering the Image tool, a false failure of the fragment rather than
of the layout. The geometry above is a **one-off measurement**; the SCOPE is
held by `tests/invariants.test.js` (no `.rail-btn` `::after` rule may exist
unscoped from `.rail-draggable`), verified by widening it and watching it
fail by name.

**Two test lessons from this round, both found rather than reasoned:**

- **A button stub must honour the selector.** The driven Board-drag block
  first used `closest:()=>__btn`, which answers whatever is asked — so it
  **passed with `drag:true` reverted**, proving the mechanics and not the
  flag. It reads `_BOARDS_RAIL_MAIN` and returns `null` for a
  `[data-drag="1"]` query now, so dropping the flag takes the block down too.
- **A `_pending` block must do ALL its awaiting before its first assertion.**
  `s.section` writes to the shared reporter, so a block that awaits *between*
  its section and its assertions has a concurrent block's heading land in the
  middle: these first reported under **"out of the Unsorted tray / one
  card"**. Both drags run and their results are captured first, then the
  sections and assertions run with no awaits between them. That is a third
  face of the `_pending` hazard already recorded twice above.

### Mood Boards — the board card is a SPINE (Sept 2026) — REVERSES option A

Afnan lived with the cover tile for a day and then picked **option D off the
same specimen**: *"i like D spine its perfect"*. Both sections above stand as
the record of what A was and why; this is what shipped over it.

**A said what a board IS. It could not say what is INSIDE one**, which is
what a card standing in for a board is actually for. D is the most a card
can say at once, 260×172:

- **The board's FACE is a 46px spine down the left edge.** It paints the
  **cover** when the board has one — a picture somebody chose for that board
  is its identity and must not be demoted to a 30px chip in the strip below,
  which is for contents — and otherwise the board's colour carrying its icon
  or first letter. Still through **`_boardsFaceOf`**, so the card, the
  gallery tile and the panel row cannot disagree about what a board looks
  like. That decision survived the redesign unchanged, which is the payoff
  for having made it once.
- **The whole name, two clamped lines**, with the state and the counts under
  it. `PRIVATE` / `TEAM` is from the specimen and cost nothing: visibility is
  already on the document and the panel row already prints it.
- **A strip of the board's own THUMBNAILS** (`_boardsBoardThumbs`), derived
  from the child board's cards on every render exactly like the gallery
  tile's live preview — nothing stored, nothing migrated, and it cannot go
  stale against the board it describes. **Image cards only**: a file card's
  page-1 thumbnail is best-effort by design (`_boardsPdfThumbUrl` hides
  itself on error) and a strip with holes punched in it says less than a
  shorter strip with none. **The +N chip counts the CARDS the strip could not
  show**, not the pictures it left out. A board with no pictures gets no
  strip rather than an empty row or a chip repeating the count above it.

**THE HEADER GOES BACK TO BEING A HEADER, and that is the load-bearing half
of the revert.** Under A it was a transparent bar with literal-white ink
floated over the picture, which only worked because the surface under it was
a photograph or a solid colour. Here the info column is the ordinary card
surface and **follows the theme**, so that ink would be white-on-white in
light mode — the failure this file keeps recording. Deleting the
`.type-board .board-card-head` override is the whole fix; `.type-board` now
wears the same strip as every other card. The name and meta moved from
literal white to `var(--text)`/`var(--muted)` for the same reason.

- **The +N chip is 13px, not the specimen's 11px.** It is card-internal
  text, so it is multiplied by the board's zoom (11px at 84% is 9.2px). The
  chip widens rather than clipping the number. `tests/invariants.test.js`
  caught this on the first run.
- **Existing cards are not resized on open** — the same rule A shipped under.
  An old card is drawn at its stored size and grown by `_BOARDS_MIN_BODY_H`
  if it is too short.
- **The `far` LOD band now drops the meta line and the thumbnails**, not the
  scrim (there is no scrim any more). At 25–35% the spine's colour is what
  tells boards apart and the name is the only text still worth painting: the
  meta is 3px there and a 30×22 thumbnail is 7×5.

**Two things about verifying, both worth keeping.** Putting a literal `#fff`
back on the title fails `smoke-layout` at **1:1 in light**, naming
`board-subboard-title` — so the fragment does hold the ink. **What it does
NOT hold, checked by removing it: the info column's `min-width:0`.** The
title carries `word-break:break-word` and a two-line clamp, so it shrinks
either way; the rule stays as a guard for whatever is added to that column
next, and both the CSS comment and the fragment say so rather than leaving
the claim standing. And the fragment had to be laid out in **two rows** — a
card past the right edge of a 1280px viewport is clipped, and the hit-test
then reports its controls as covered by whatever it finds at that point.

**The CACHE_VERSION collision, benign shape:** `origin/main` had moved to
Ammar's `v121` while this sat at `v120`. Merged, then bumped past both to
**`v122`** — checked against the CURRENT `origin/main`, which is the half
that keeps getting missed.

### Mood Boards — the board card says it opens (Sept 2026)

Afnan: drop the Open pill, glow the corners in red while the card sits idle,
and say how on hover.

- **The idle glow** is four corner radial gradients breathing on a 2.8s
  cycle, in **`--count-accent`** — the app's one real red, which
  deliberately does not invert. Right here for a second reason: the glow
  sits on a cover **photograph**, so there is no theme for it to follow.
- **Hover swaps the hint for the instruction** — *"Double-click to open your
  mind"*, Afnan's own line minus the emoji the module's chrome rule
  excludes. The glow drops to a fifth while it shows, so the two never talk
  over each other. The CTA is `pointer-events:none`, so it cannot eat the
  double-click it is advertising.
- **Both hang off `.openable`**, which the render sets ONLY when the child
  board is really there. A board that is gone, or an orphan with no
  `boardId`, gets neither — **nothing should invite a double-click that
  cannot do anything.** The orphan keeps its repair button, which is a
  different thing: that card is unusable until it is adopted.
- **THE PILL SURVIVES ON A PHONE**, deliberately. There is no hover there,
  and `dblclick` is not dependable once `.board-stage` has taken
  `touch-action` — exactly why double-tap-to-place is paired by hand in this
  file. Removing it would leave a board with no way in but a long-press
  nobody would guess at.
- Neither survives `far` zoom, where a card is just its picture; both
  respect `prefers-reduced-motion`.
- **The layout fragment renders a SECOND copy of the cards with the CTA
  forced visible**, because the probe cannot hover — without it the most
  legible thing on the card (white on a dark wash over an unknown
  photograph) would never be measured. Verified by darkening it: 1.23:1,
  named.

### Mood Boards — the QA round (Sept 2026)

Afnan ran an exhaustive pass over a real private board — every tool, every
menu action, every top-bar control, keyboard, Unsorted, connectors, frames,
reactions, labels, comments, autosave — and filed eight findings. Four of
them shared one cause, and that cause was a regression from the
click/double-click change above.

**The regression: `el.focus()` stopped meaning anything.** Card bodies now
ship `contenteditable="false"` and exactly one element is switched on at a
time. Four actions (`rename`, `renameheading`, `caption`, and the heading
branch of rename) were still doing `document.getElementById(…).focus()`,
which on a non-editable node focuses nothing typeable — **the field
appears, you cannot type, and nothing saves.** Reported as "Image Caption
does not save (confirmed, repeatable)". All four now call
`window.boardsBeginEdit(null, id)`, which is the only thing that makes an
element editable. **Any future action that wants to put a caret in a card
must go through `boardsBeginEdit`, never `focus()`.**

The rest:

- **The Board tool minted an orphan.** The rail called
  `boardsAddCard('board')`, which builds a `type:'board'` card with no
  `boardId` — it renders "Missing board" and can never be opened. The real
  creator, `boardsAddChildBoard()`, already existed on the ⋯ menu; the rail
  simply wasn't calling it. `boardsAddCard` now routes `'board'` there.
  **A card type that is a LINK to something must never be creatable
  without the thing it links to.**
- **Line mode survived leaving the board.** `_boardsLineMode` was reset
  nowhere — Find, the ⋯ menu and undo history all reset on board open, and
  this was missed — so turning it on once made every later board open in
  arrow-drawing mode, and the first drag drew a line instead of moving a
  card. Reported as "Line tool defaults to ON". Reset with the rest.
- **A drag that ended on a file card opened the PDF.** A card drag ends
  with a `click` on whatever is under the pointer, and a file card's body
  is an `<a href>`. `_boardsSuppressClick` is armed in the drag's `up()`
  when the gesture actually moved (`pushed`, which is set on the first real
  `pointermove`) and swallowed by a capture-phase document listener.
  Selection already happened on `pointerdown`, so that click had nothing
  left to do.
- **Double-clicking a heading often did nothing the first time**, and the
  text typed after it was lost — the heading's drag strip sits over the top
  of the banner, so the first attempt lands on the strip. Double-clicking
  any card's HEADER now opens that card's primary editable (banner text for
  a heading, the name label for everything else): one rule instead of a
  special case.
- **New cards spawned stacked.** `_boardsPlacementPoint`'s cascade repeats
  every 6, so the 7th card landed exactly on the 1st. It now steps off
  anything already within 18px, bounded at 40 tries — on a dense board,
  burying one card beats looping.
- **Reactions clipped a sub-board card's title away.** A card is a
  fixed-height flex column with `overflow:hidden`, so a reactions row
  steals height from the body; on a small card the title vanished entirely,
  leaving "Board · Missing board · 👍1". The body yields its space
  (`flex:1;min-height:0`) instead of the content disappearing.
- **The resize grip was a 13px target** and the ⋯ menu could stick. The
  grip is now a 24px hit area with a 13px glyph and a hover cue. The menu's
  outside-click closer used to bail on `if(!_boardsMenuOpen)return`, so any
  action that cleared the flag without also calling `_boardsSyncMenu()`
  left the menu visible and unclosable until the next render; it now reads
  the DOM as well as the flag. **The exact action that desynced them was
  not identified** — the closer no longer depends on the two agreeing.

### Mood Boards — connectors: selectable, styleable, curved (Sept 2026)

Afnan: lines "are not getting selected", clicking does nothing, the
right-click actions are missing, and there is no way to curve one.

- **Why they could not be clicked was GEOMETRY, not a missing handler.**
  The stroke was 1.6 **world** px with `pointer-events:stroke`, so at his
  68% zoom the target was about one physical pixel of a diagonal line.
  Every connector now ships an invisible ~16px companion stroke
  (`path.conn-hit`, emitted first) that takes the pointer events. It is in
  world units too, so the target scales with the zoom instead of vanishing
  at it. **Reuse this for anything else drawn as a thin stroke.**
- **Connectors carry an `id` now.** Selection by array index silently jumps
  to a different line the moment a delete shifts the indices. They are
  merged wholesale rather than per item (`_boardsConnDirty`), so an id
  costs nothing at sync time. Older connectors get one **in memory before
  `_boardsConnBase` is taken**, so the migration never dirties a board on
  open — asserted.
- **Card selection and line selection are mutually exclusive.** Two kinds
  of "the selection" at once would make Delete and the rail ambiguous.
- **A curve is a quadratic Bezier, and the bend is stored as the APEX
  offset (`bx`/`by`), not the control point.** The apex is where the drag
  handle sits, so dragging is exact rather than doubled; and an **offset**
  means a card-bound curve keeps its bend when the cards move, where a
  stored control point would leave the curve behind. The control point is
  derived — `mid + 2·offset`, since for a quadratic the apex is
  `.25·p1 + .5·c + .25·p2`.
- **Dragging an endpoint detaches a card-bound line into a freeform one**
  and the drop decides whether it re-attaches. Anything else means an
  endpoint you cannot move off a card. The bind targets live in the drag
  CLOSURE: connectors are saved as plain JSON with no `_`-prefix stripping
  of their own (that rule is for cards, `_boardsCardsForSave`), so a
  scratch field parked on one would be written to the document.
- **The rail's third mode** is a selected line — Color / Start / End /
  Label / Dashed / Weight, matching Milanote's own — and the right-click
  menu builds the same actions through the same router
  (`_boardsConnAction`).
- **The PNG/PDF exporter reads the same `_boardsConnGeom` the canvas
  does**, so a curve, a weight or a second arrowhead cannot render one way
  on screen and another in the export. Arrowheads point along the
  **tangent** (from the control point), not the chord.
- One `<marker>` serves both ends: `orient="auto-start-reverse"` is exactly
  what `marker-start` needs, and `currentColor` makes the head follow the
  line's colour. A label is an **empty `<text>` filled with `textContent`**
  — same boundary as card text; a stroke colour is a fixed palette name
  mapped to a CSS variable, so nothing else reaches a style attribute.

### Mood Boards — closing the line gaps (Sept 2026)

Afnan ran Milanote's lines properly and reported back. Most of the round
above already matched; four things did not.

- **Dragging the body moves the line — but only a FREEFORM one.** A
  card-bound line's endpoints ARE the two cards, so dragging it would do
  nothing or silently break the connection; its midpoint handle still
  curves it, the only free parameter it has. Because the bend is stored as
  an **offset from the midpoint**, moving both endpoints carries the curve
  with no extra work — the payoff for that storage choice.
- **Right-click parity**: Cut / Copy / Duplicate / Delete as the shared
  opening block (the same shape a card's menu has, so the shortcuts are
  taught in both places), then Lock position and Bring to front / Send to
  back. **Z-order is a reorder of `_editConnectors`** — connectors paint in
  array order exactly like cards, so no stored field and no migration.
  A locked line keeps its selection outline (that is how you unlock it) and
  loses every handle plus the styling entries it cannot apply.
- **Ctrl+C / Ctrl+V** through the real clipboard events, so the system
  clipboard stays the single source of truth. **A separate tag
  (`groovy-board-lines:`) rather than a shape change to the card payload** —
  an older build in another tab still reads the card one, and a line pasted
  into it is ignored instead of arriving as a malformed card. The id is
  stripped on copy so a paste always mints its own. A **card-bound line
  pastes as the shape it was DRAWN in**, flattened to freeform at its
  current endpoints, because the cards it names may not exist on the board
  being pasted into. Note there are **two** paste paths — the keyboard one
  and the right-click one — and both needed it.
- **Custom colour.** The board colour picker serves two kinds of target now
  through one pair of helpers (`_boardsColorCurrent`/`_boardsColorApply`)
  rather than four call sites each growing a branch. A custom line colour
  is a literal `#RRGGBB` through `_boardsValidHex`; palette names still
  work alongside, and anything unrecognised **falls back rather than being
  passed through**.

**Deliberately not matched:** Milanote sends a deleted line to Trash. Cards
here have no trash either — Ctrl+Z covers them, and a second recovery
system for a one-keystroke-recoverable action is not worth its complexity
(Stage 1).

### Mood Boards — Table, document export and Presentation (Sept 2026)

The last three Milanote gaps, shipped together because two of them share
one idea.

**Table** is a plain `rows[][]` of strings on the card — no per-cell
records and no column schema. The engineering spec proposed typed columns;
that is a second data model to migrate and validate, to hold what these
boards actually use a table for (a small grid of text beside a tech pack).
A typed table can be built on top of this later; the reverse is not true.
Cells follow the click/double-click rule like every card body and are
hydrated with `textContent`. **Adding a row or column grows the card** — or
the new row is drawn outside it and clipped, the same class of bug the
label and reaction rows caused.

**Reading order is built once and used twice** (`_boardsReadingOrder`). A
board is a plane; a document and a slideshow are both a LINE. Two orderings
would disagree the first time anyone added a frame. Frames first (a frame
is how these boards mark a section), each followed by what is inside it,
then everything loose; within a group, cards are **banded by y** (120 world
px) and sorted left-to-right inside the band — plain y-sorting reads a row
of four cards as four rows, plain x-sorting reads columns. A column is
emitted whole, in the order it already owns.

**Document export** — Word, Markdown, plain text, with an optional
recursive pass through nested boards (offered only when there are any).
**The Word file is HTML with a `.doc` extension**, which Word opens keeping
headings, lists, tables and images. A real `.docx` means a ZIP writer and
an OOXML template — a library, against the zero-new-deps line — and the
download toast says so rather than implying otherwise. The recursion swaps
`_editCards` to read a child board (frame membership and column children
are both computed from it) and restores it in a **`finally`**, so a throw
cannot leave the open canvas pointing at another board's array.

**Presentation** walks that same order. Arrow keys, space, PageUp/Down,
Home/End, click to advance, Escape to leave; past the last slide it exits
rather than sticking. Cards with nothing to show are skipped rather than
shown blank. It is **its own fixed overlay, not a mode on the canvas** —
the canvas is a pan/zoom surface with a rail, a minimap and a tray, and
hiding all of that is more work, and more ways to leave it hidden, than
drawing a clean screen. Slides are built with `createElement` +
`textContent`: a slide is the one place a stored string is drawn at 60px,
so getting that wrong here would be the most visible XSS in the app.
`100dvh`, not `inset:0`, for the reason the canvas takeover documents.

### Mood Boards — Column is a real container (Sept 2026)

**This reverses the Stage 3 substitution on purpose**, at Afnan's request.
"Group into Column" was an arrange-once action; it builds a real container
now — one that keeps its order, moves as one, accepts drops and ungroups.

**Frames stay membership-free; a column cannot be.** Geometry answers "what
is inside this box", which is all a frame needs. A column has to own an
ORDER and position its children from it, so membership is stored.

- **Membership lives on the CHILD (`c.columnId`), never as an
  `items:[cardId,…]` array on the column.** That array was the obvious
  shape and is the wrong one: the Stage 6 merge is per CARD, so two people
  each adding to the same column would both rewrite it and the later write
  would win, silently dropping the other's insert. With `columnId`, every
  insert is a change to a different card and the merge keeps both —
  **joining a column never writes the column document at all.**
- **Order is derived from the child's own `y`**, which the layout already
  writes. No second field to keep in step, no fractional-index scheme.
  **Ties break on card id**, so two cards that land on the same y after a
  merge still order identically on every screen.
- **`_boardsLayoutColumn` is idempotent, and that is load-bearing.**
  Opening a board must not mark every card as locally changed (see
  `_boardsLocalChanges`) and fire a write for a layout that is already
  correct. Asserted in `tests/boards.test.js`.
- **A stale `columnId` is INERT** — the card renders as an ordinary free
  card. Nothing is reconciled on read, and no failed write can strand a
  card inside an invisible box. Same discipline as nesting and frame
  membership.
- **Deleting a container never destroys content.** The ✕, Delete and a
  selection delete all RELEASE the cards where they sit and say how many
  were kept; **"Delete column and its cards" is a separate, confirmed
  action**. That was the open question from the Milanote teardown (item
  G9): the safe thing is the default, the destructive one is explicit.
- **Children travelling WITH their column are not re-homed.** Found by
  re-reading before shipping, not in testing: a dragged column puts itself
  in `movingCols`, so it is not a valid drop target for its own children —
  read naively that is "dropped on empty canvas" and **every card falls out
  the moment you move the column**, or move a frame around it.
  `_boardsDropTargets` skips them; a test guards it.
- **Which column a dragged card joins is an OVERLAP test, not the card's
  centre point** (Sept 2026 — see "the column, rebuilt" above). The centre
  rule refused a card sitting 45% inside a column, measured; the rule is
  now the column sharing the most area, at ≥30% of whichever box is
  smaller. `_BOARDS_COL_HEAD` is 63 and is MEASURED — it lives in
  `js/boards.js` and in `.board-column-body`'s `top`, and an invariant
  fails if the two drift apart.
- **A column's height is derived and a child's width comes from the
  column**, so neither axis is draggable — a handle that silently snaps
  back is worse than not offering that axis. Resizing reflows by writing
  styles (`_boardsPaintColumnGeometry`), not by rebuilding the canvas: a
  full render per `pointermove` would redraw every card and connector on a
  46-card board.
- **Containers never nest.** A column is not a drop target for a column or
  a frame — one layout model is enough.
- **Duplicate copies what is inside a column** and remaps `columnId`
  through the same id map the connectors use; a child copied alone is
  freed rather than left pointing at the original.
- Columns paint behind their children (`_boardsRenderOrder`: frames,
  columns, then everything else). Select contents reads **membership** for
  a column and **geometry** for a frame — the one place the two containers
  genuinely differ. The drop indicator lives inside `.board-world`, so it
  is positioned in world coordinates with no pan/zoom maths.

`tests/harness.js` gained **`confirm`/`prompt`** (recorded in `state`,
answering yes by default, overridable through `globals`) — the app has two
blocking dialogs and neither could be exercised before.

`tests/smoke-layout.js` gained a fragment that MEASURES a laid-out column.
**What it does not prove, checked by removing the rule:** the column's
`pointer-events:none`. The children are painted above the column as later
siblings, so `elementFromPoint` reaches them either way. That rule is for
panning and marquee **through** the column background, which no layout
measurement can see.

### Mood Boards — the table, rebuilt to the Milanote spec (Sept 2026)

Afnan sent a Milanote board that is itself a 9-section visual spec for our
board tool — sidebar rail, overflow flyout, add-image panel, then table
anatomy, cell toolbar, cell types, formulas, row/column ops and the object
menu. **Agreed process: one milestone at a time, finish and verify before
the next.** The milestone list, in dependency order: M1 cell model ·
M2 table anatomy · M3 row/column ops · M4 cell types · M5 formulas ·
M6 rail restructure + overflow flyout · M7 add-image panel · M8 object menu
gaps. The six new card types the flyout implies (Sketch, Color, Document,
Audio, Map, Video) are deliberately NOT in M6 — Draw especially is a whole
drawing surface, not a card variant.

**M1 — the cell model.** A cell is stored as a **bare string until it
carries an attribute**, and becomes `{v,…}` only then. That single choice is
what makes M3–M5 need no migration: `Auto`, the default cell type, is
exactly what a bare string already means, so every table written before this
reads correctly untouched. `_boardsCellWrite` **downgrades back to a string
the moment the last attribute is cleared**, so a cell bolded and un-bolded
leaves no object behind on a document that is rewritten on every autosave.
**Seven call sites read `c.rows[r][i]` raw** — the hydrate, the Word/Markdown
export, the presentation slide, the PNG/PDF canvas, the PDF index, the search
index and the input handler — and every one would have rendered
`[object Object]` the first time a cell grew an attribute. All go through
`_boardsCellVal` now; nothing outside the helpers touches a cell directly.

- **A cell colour is a palette NAME painted by a class, never a stored hex.**
  The first cut validated `#RRGGBB` — wrong here, because the swatch palette
  maps to CSS variables that INVERT with the theme, so a literal hex is
  light-on-light in dark mode: the exact bug the embellishments sweep
  removed one commit earlier. Six names is also a stricter allow-list than
  validating a hex, and nothing about the background reaches a `style`
  attribute at all.
- **Focus is independent of edit mode** (`_boardsCellFocus`, separate from
  `_boardsEditingEl`). Every rail action re-renders the canvas and destroys
  the DOM the caret lived in, and the cell toolbar has to stay up while you
  use it — focus is data, so it survives that. It is **re-derived, never
  trusted** (`_boardsFocusedCell`): a row can be removed, the card deleted,
  or a remote merge can shrink the table, and a stale `{id,r,i}` must not
  paint a ring on whatever moved into those coordinates. Cleared with the
  selection, on Escape, and per board-opening beside line mode and undo.
- **The rail's FOURTH mode** (nothing selected / card / line / cell), through
  the same `_boardsCtxRun` router as the other three.

**M2 — table anatomy.** Default is **3 × 4, empty, `head:false`**: the A/B/C
band labels the columns now, and a prefilled "Column A" header row would be
a second labelling of the same thing that disagrees the moment one is
renamed. Existing tables are untouched.

- **Coordinates are DERIVED and never stored** — `_boardsColName` (A…Z, AA…)
  and `_boardsCellRef`, with `_boardsRefToRC` as the inverse for M5's parser.
- **They map 1:1 onto the stored array: `B1` is `rows[0][1]` whether or not
  `head` is set**, because `head` is pure styling (row 0 renders as `<th>`)
  and nothing else. A spreadsheet whose row 1 holds labels and whose sum
  reads `SUM(B2:B4)` is what everyone already knows, and the grammar then
  needs no special case anywhere. **Decided in M1, before any formula code.**
- **The band and gutter stay visible when the table is not selected, just
  dimmed.** Milanote raises them only on selection; ours are the reference
  grammar for formulas, so hiding them hides the feature — and a
  selection-only band would either reflow the table under the pointer or
  need an overlay escaping a card that clips its own content.
- Both are **sticky** (`top:0` / `left:0`). **Corrected after the browser QA
  round: a table almost never scrolls vertically.** `drawH` is
  `Math.max(c.h,_boardsMinCardH(c))` and the resize handle is clamped by the
  same function, so the card GROWS to fit its rows and cannot be shrunk
  below them — 15 rows makes a tall card, not a scrollbar. The sticky band
  therefore only engages where the per-row height estimate **under-counts**
  (wrapped text in narrow cells — exactly the 420px case that caught the
  `+Row/+Col` bug) or on **horizontal** scroll with many columns. The work
  is not wasted, but scrolling is the exception, not the normal case.
  **Open design question for later:** a 100-row table becomes a ~3,000px
  card. Growing beats scrolling for seeing your data, but it should cap
  somewhere. Not changed mid-QA.
- **Not built, deliberately: the round top-right selection handle.** Our
  cards already carry a drag header and a selection outline, and that corner
  is where the delete ✕ lives. The bottom-right diagonal resize handle the
  spec asks for **already exists** for every card and is clamped by
  `_boardsMinCardH`.
- A table can now carry a **caption**, matching the spec's table toolbar
  (Labels · Reactions · Comment · Title · Caption); the other four were
  already there.

**M3 — row and column operations (§8).** Insert and delete act RELATIVE to
the focused cell, from a cell right-click menu and from Alt+Arrow.

- **Positional is the ONE implementation.** `boardsTableAdd`/`Drop` used to
  append and pop; they are thin wrappers now (appending is inserting at the
  end, dropping is deleting the last), so the bounds checks exist once.
- **The focused cell MOVES with the edit.** Insert a row above it and its
  row index shifts down by one; leave the index alone and the focus ring
  lands on the blank row just pushed under it, which reads as the caret
  jumping. `_boardsFocusedCell` re-derives and so can drop a stale focus,
  but it cannot know that a cell MOVED — only the operation knows that.
  Deleting the focused row or column clears the focus outright.
- **A table cell is the one place this file takes the right-click menu back
  from the browser while text is editable.** Everywhere else — a note body,
  a to-do item, an input — the browser's menu wins, because spellcheck and
  text copy/paste belong to it while you are writing prose. A spreadsheet
  cell is not prose. Right-clicking a cell focuses it first, the same rule
  a right-click on an unselected card or line already follows.
- **Alt+Arrow is read BEFORE the editable bail**, like Escape, because a
  focused cell is contenteditable and the bail would swallow it every time.
  It is gated on a focused cell existing, so the one thing it costs —
  Alt+←/→ as word-jump on a Mac — is unavailable only inside a table cell,
  which is exactly where the spec asks for the shortcut.
- **Cut and Copy raise the REAL clipboard events** (select the cell, then
  `execCommand`), keeping the system clipboard the single source of truth —
  the rule the card menu already follows. **Paste cannot**: browsers refuse
  `execCommand('paste')` from script, so it goes through
  `navigator.clipboard.readText()` and says "Press Ctrl+V" plainly when
  that is refused, rather than failing silently.

**M4 — cell types (§6).** `auto · number · currency · percent · text ·
date · check`, each with a per-type format config.

- **THE VALUE IS ALWAYS THE RAW STRING THE PERSON TYPED.** A number cell
  stores `'1200'` and DISPLAYS `1,200`; the formatting is derived at render
  and never written back. That is what makes a type change lossless in both
  directions — switch to Text and you get your `'007'` back, not `'7'` — and
  it keeps `_boardsCellVal` the single reader every export, the search index
  and M5's parser can rely on.
- **`auto` is the ABSENCE of a type**, which is why a bare string needs no
  migration to have one, and why picking Auto *clears* rather than stores.
  Auto does not reformat what you typed: it renders verbatim and only
  right-aligns a numeric value, because a type you did not choose silently
  rewriting `'007'` would be the most surprising thing in the feature.
- **`t` and `fmt` had to be added to `_BOARDS_CELL_ATTRS`.** That list
  drives `_boardsCellWrite`'s downgrade-to-a-bare-string; leave a key out of
  it and the attribute is thrown away the instant it is the only thing the
  cell carries. Asserted both ways.
- **Percentage does NOT multiply by 100** — type 12, see `12%`. A deliberate
  divergence from the spreadsheet convention: in a garment ops tool people
  type 12 meaning a 12% rejection rate, and turning that into 1200% silently
  would be the most confusing thing here. M5 reads the underlying 12.
- **Numbers are read tolerantly** (`_boardsCellNum` strips separators, a
  currency symbol, a trailing `%`), because the stored value is raw text and
  a typed cell should not stop computing because someone pasted `1,200`.
- **A typed numeric cell holding prose is FLAGGED, never rejected** —
  refusing a keystroke inside a `contenteditable` is miserable, and the
  person can see what they typed and fix it.
- **You edit the raw value, never the formatted one.** A currency cell
  showing `Rs 1,200` puts `1200` under the caret, or the first keystroke
  would append to a string the model never held. `_boardsEndEdit` swaps the
  display form back by repainting **that one cell** — it fires on every
  click away from a cell, and rebuilding every card and connector on a
  46-card board to reformat one number would be absurd.
- **A checkbox is the one cell operated with a single click**, so it carries
  the `onpointerdown` guard every control inside a drag surface needs — the
  delete-✕ bug in a new place.
- The type menu's four `›` entries **set the type and then open the format
  menu**, two sequential menus rather than teaching the context menu to
  nest. **Clear resets presentation only** — a type is what the cell IS.

**The QA round after M4 found three things, and two were never M1–M4's
fault at all — they had been broken since the table card shipped.**

- **A cell could never be double-clicked, on any build.**
  `boardsCardDragStart` calls `setPointerCapture` on the card body, and a
  captured pointer **RETARGETS the following `click` and `dblclick` to the
  capturing element**. A note survives that because its `ondblclick` sits on
  the very element carrying the drag handler; a table cell's sits on a
  DESCENDANT, so the cell's handler never ran and the dblclick bubbled to
  the stage — which is why double-clicking a table **spawned a stray note**
  instead of putting a caret in the cell. The fix was the guard the delete ✕,
  the card-name span and the comment badge already carry:
  `onpointerdown="event.stopPropagation()"` on every data cell. **Anything
  clickable inside a drag surface needs it — this is the third time.**
  ~~The cost is that a table no longer drags by its cells; it drags by its
  header strip and by the A/B/C band and row gutter.~~ **SUPERSEDED, and
  that "cost" was itself a bug** — the header strip became inert two rounds
  later, and the grid inherits `cursor:grab` from the card body, so ~44% of
  a table card promised a grab and would not move. A TEXT cell carries no
  guard now and drags like a note body; a CHECKBOX cell keeps it. The
  capture is deferred past the drag threshold instead — see **"to do not
  moving properly", and the guard that caused it**.
- **FIRESTORE DOES NOT SUPPORT NESTED ARRAYS, and `rows` is one.**
  `updateDoc` refused every board carrying a table outright — "Nested arrays
  are not supported" — so **table content had never persisted**, from the
  day the table card shipped. It surfaced as a repeating "Save failed — will
  retry" only once tables started being used in anger. The **wire form wraps
  each row in an object**: `[{c:['a','b']},{c:['c','d']}]`, an array of
  OBJECTS each holding an array, which is legal. In memory rows stay the
  plain nested array every helper reads, so the encoding lives at exactly
  two boundaries — `_boardsCardsForSave` on the way out, and
  `_boardsDecodeCards` at every point a document's cards come back in (board
  open, the Stage 6 merge, the doc-export child walk, `loadBoardsData`'s
  gallery list, the `moodBoards` mirror). Both directions are **idempotent
  and total**, so an older board (plain nested rows) still reads and an
  older build reading the new form renders an empty table rather than
  corrupting one. `tests/boards.test.js` asserts the **rule**, not the
  field: nothing `_boardsCardsForSave()` produces may nest an array in an
  array, so a future array-of-arrays anywhere on a card fails there first.
- **Escape and clicking away did not leave cell mode.** Escape was gated on
  `_boardsEditingEl`, but a cell focused by RIGHT-CLICK has focus without
  edit mode, so it fell straight through; and `_boardsSetSelection` — the
  path a click on empty canvas takes — left the focus behind. The ring and
  the cell rail stayed up with no way out but the Done button. **Note the
  two fixes overlap:** line 893's Escape clears the selection, which now
  drops the focus too, so the gate change is only exercisable with an EMPTY
  selection. The test isolates it that way on purpose — with a card selected
  it proves nothing.

**M5 — formulas (§7).** SUM · AVERAGE · MIN · MAX · COUNT · IF, over M2's
`B2:B4` grammar, with a hand-written tokenizer and recursive-descent parser.
No library: this module has held the zero-new-deps line since Stage 1, and
the grammar is small enough to read in one sitting.

- **A FORMULA IS THE CELL'S VALUE, not a separate field.** `v` holds the
  literal text `=SUM(B2:B4)`. The spec's build note proposed a `formula`
  field; storing it in the value is better here and all three reasons fall
  out of M4's model — the raw string is what you EDIT, so a double-click
  already puts the formula under the caret with nothing new wired; it
  round-trips through every export, the clipboard and the search index
  because those already read the raw value; and it needs **no entry in
  `_BOARDS_CELL_ATTRS`**, so the downgrade-to-a-bare-string can never throw
  it away — the exact bug that nearly ate cell types in M4. Typing
  `=SUM(B2:B4)` by hand also just works, which is what anyone will try.
- **THE RESULT IS NEVER STORED.** It is computed at render from the grid as
  it stands, so there is no cache to invalidate and no way for a stale total
  to outlive a dependency change. The cost is a few thousand lookups on a
  structural render; the renders that matter for feel (drag, resize) do not
  rebuild cells at all.
- **Nothing rerenders on a keystroke** — the caret has to stay put — so a
  total would not move while you type into a cell it depends on.
  `_boardsRepaintFormulas` runs from `_boardsEndEdit`, repainting every
  formula cell in that table the moment you leave.
- **`_boardsFxRun` never throws**, whatever it is handed. It always returns
  `{value}` or `{err}`, so a broken formula shows `#ERR!` **in the cell**
  rather than taking the render down with it. Fuzzed with a junk list in
  `tests/boards.test.js`.
- **Cycles are caught by a `seen` set of `r,i` keys threaded through every
  reference**, so `=A1` in A1 and a two-cell loop both read `#CYCLE!`
  instead of hanging the page.
- **Text in a range is SKIPPED, not zero and not an error** — a column of
  figures under a heading must still add up. `COUNT` counts numbers, not
  cells, which is Excel's rule and the one people expect.
- **The answer is formatted by the CELL's type**, so `=SUM(B2:B4)` in a
  currency cell reads `Rs 45,000` like any typed number would.
- **Arithmetic ships too, beyond what the spec asked.** `IF`'s condition
  needs a comparison evaluator anyway, so `+ - * /`, unary minus and parens
  came almost free — and a formula feature where `=B2*1.15` silently failed
  would be reported as broken the same day.
- Errors: `#REF!` (a cell or range past the edge) · `#CYCLE!` · `#NAME?`
  (unknown function) · `#DIV/0!` · `#ERR!` (unreadable). A formula cell
  carries a faint corner mark so a computed total is distinguishable from a
  typed one — knowing which is which is the whole reason to trust it.

**M6 — the rail, rebuilt against OBSERVED Milanote, not the written spec.**
A browser study of the real product contradicted the spec twice, and both
contradictions changed what got built. That session was scrupulous about its
limits — **no computed CSS, no mid-drag frames, no reduced-motion
emulation** — so every timing in it is eyeballed and none of it is recorded
here as fact.

- **Add image does NOT swap the rail.** The spec says the media tools
  "swap the rail for a full context panel" with "a back-arrow at the rail
  top". Observed: the rail stays intact and the panel opens as a **popover
  anchored to the button**, with a tail, toggled by clicking the button
  again. **The back-arrow belongs to the SELECTION rail, not the media
  panel** — the spec conflated the two. So the overflow (`…`) is a popover
  through the existing `_boardsOpenCtx`, not a second popover
  implementation, and the **back-arrow was added to our selection rail**,
  which previously had no route back to the add-tools except clearing the
  selection.
- **Single-click-then-click-to-place could not be reproduced** in the real
  product — no armed state, no cursor change, no floating preview — and the
  observer saw a "Drag me" coach-mark instead. **It is deliberately NOT
  built.** Our click already places a card immediately, which is useful;
  trading that for an unverified two-step arm would be a regression on the
  strength of a spec sentence nobody could confirm.

What shipped: the rail is **grouped** (content tools · divider · `…` ·
media · Comment/Fit) with `_BOARDS_RAIL_MAIN` / `_OVERFLOW` / `_MEDIA` as
the three lists, and **drag-to-place**.

- **The drag is pointer-based, never HTML5 drag-and-drop.** The stage reads
  a native `dragstart` as "files from the desktop" (`_boardsInternalDrag`),
  so a native tool drag would raise the file-drop overlay — the same
  collision that made card images undraggable until Sept 2026.
- **Nothing is created until the pointer comes up over the stage.** Released
  on the rail, over the top bar or outside the window, the drag is
  abandoned; Escape abandons one in flight.
- **Click-to-place is untouched.** A press that never moves past 5px is
  still a click, and `_boardsSuppressClick` is armed only when the drag
  actually moved — otherwise the drag would eat its own click.
- The ghost is a chip at the cursor that **brightens over the canvas**, so
  "this will land" and "this will be abandoned" look different before you
  let go. Deliberately ONE generic size rather than per-type dimensions:
  those live in `_boardsNewCard`, which is **not pure** (it mints an id), and
  a second copy of that table would be a second thing to keep in step.
- **No Trash at the foot of the rail.** Milanote has one because a deleted
  card goes to a per-board trash; ours do not — Ctrl+Z covers them
  (Stage 1) — so a Trash here would be a second Delete button pretending to
  be a safety net.

**M7 — the add-image panel (§3).** A popover (`_boardsOpenSheet`), not a
rail swap — see M6's correction. Two halves, and they are **not equally
trustworthy**, which the panel itself says.

- **The provider key lives in `netlify/functions/image-search.js`**, in
  `process.env`, never in client code. `js/*.js` is a public static asset;
  a Pexels key pasted into `js/boards.js` would be a published key. A leaked
  search key is not a data breach — which is exactly why it is tempting to
  shortcut — but it still burns someone else's quota and still breaks the
  rule the rest of this repo holds, so it gets no exception for being cheap.
- **"Not configured" is a first-class answer.** With no `PEXELS_API_KEY` the
  function returns `200 {configured:false}` and the panel shows upload only,
  because a red error for a feature nobody switched on reads as a bug.
  **To enable: Netlify → Site settings → Environment variables →
  `PEXELS_API_KEY`**, a free key from pexels.com/api.
- **UNVERIFIED AGAINST THE LIVE API.** The sandbox cannot reach
  `api.pexels.com`, `api.openverse.org` or `api.unsplash.com` — all three
  refused at the egress proxy, checked. The request shape and response
  mapping are written from the documented API and have **not** been
  exercised. Treat the first real call as the test.
- **Keyword chips are DERIVED from the board's own words** (`_boardsImgKeywords`
  over `_boardsCardText` plus the title, stop-worded, capped at six).
  Nothing stored, nothing to keep in step — the same discipline as the label
  library and frame membership.
- **Picking a stock photo UPLOADS it to Cloudinary rather than storing the
  remote URL.** A remote URL would make the card depend on a third party
  forever and would break the PNG/PDF export the first time that host does
  not send CORS headers — the exporter draws with `crossOrigin` and a
  tainted canvas refuses `toBlob` outright. Re-uploading makes a picked
  photo indistinguishable from one off your own disk. Cloudinary takes a
  remote URL as `file` on an unsigned upload, so it is one request and does
  not depend on the photo host allowing a cross-origin fetch. **If it fails
  the card is not created and the failure is said out loud** — a silently
  fragile card is worse than no card.
- **Upload lands on the CANVAS, never in an Unsorted holding area** — the
  one thing the spec's build note explicitly asked us to do differently.
- Found while building: `_boardsImgPanelRepaint` first used
  `getElementById('board-sheet-body')`, but **`.board-sheet-body` is a
  CLASS**. It fails silently and the panel never repaints — exactly the
  dead-button shape this module keeps producing. `querySelector` now.

**Still unmeasured, and the honest way to get it:** every motion timing in
the study is eyeballed. Real durations and easings need DevTools' Animations
panel on the live product, or a 60fps screen recording stepped through. **No
motion work should be done off the estimates** — that is M9's problem, and
it starts with measurement.

**A card names its own type in its header, and the table did not.** The
`kind` ternary (`js/boards.js`, `_boardCardHTML`) had no branch for `table`,
so it fell through to `'Note'` — a table card labelled itself NOTE. Found in
the browser QA round and filed there as cosmetic; it is a mislabel, and it is
one line. Columns and frames render their own markup with an in-place title
and **no type label at all**, so they were never affected — asserted, so the
distinction stays on the record rather than being re-investigated.

**The `+Row/+Col` strip lives OUTSIDE the scrolling element**, and it took
three attempts. As a plain flex child it scrolled out of reach on a table
taller than its card; made sticky, it then covered the bottom row so a
checkbox there could not be clicked. Both were found by `smoke-layout`, both
only with a table that actually overflows — and the hit-test check reads a
legitimately scrolled-away control as "covered", so **the fragment cannot
hold that ground**. The nesting is what matters, so `tests/boards.test.js`
asserts the nesting instead. Worth knowing when adding a control to any
scrolling card body.

**`_boardsTableMinH` measures per ROW, not as a flat count** — a cell set to
the large text size makes its whole row taller, and a flat 28px left the
`+Row/+Col` strip hanging outside the card. **Found by `smoke-layout` the
same day the size attribute shipped; no logic suite could have seen it**,
and both that and the sticky strip were verified by reverting each and
watching the check fail.

### Mood Boards — M8: the object menu, and the Trash we did not build (Sept 2026)

The last milestone of the Milanote spec round. §9's object menu was already
built — Cut/Copy/Duplicate/Delete with their real shortcuts, Group into
Column, Lock, Bring to front, Send to back, and the provenance footer. Its
**build note** was the open question: *deletes should go to a recoverable
Trash and never hard-delete by default.*

**Afnan declined the Trash** ("keep ctrl+z, no card trash"), which matches
what this file had already decided twice on its own — cards have no trash
(Stage 1) and neither do connectors, because Ctrl+Z covers them and a second
recovery system for a one-keystroke-recoverable action is not worth its
complexity.

**That decision is only defensible if the keystroke is DISCOVERABLE, and it
was not.** `boardsDeleteCard`, `boardsDeleteSelection` and
`boardsDeleteConnector` all called `_boardsPushUndo()` and then said
**nothing at all**. The safety net existed and nobody was told about it —
which, from the seat of a person who has just lost a card, is
indistinguishable from not having one. So M8 is not a Trash; it is the
honesty a missing Trash requires.

- **Every delete names what went and how to get it back.**
  `_boardsUndoableToast(what)` is the single phrasing
  (`"Note deleted — press Ctrl+Z to undo"`), and `_boardsCardNoun(c)` is the
  single type→word map so no toast reads a generic "Card deleted". The map
  is asserted per type, because the card header's own type label had exactly
  this bug (no `table` branch, so a table introduced itself as a NOTE).
- **Deliberately a toast, not a confirm.** A confirm on every delete is the
  thing that makes people stop reading confirms — and then the one that
  matters is clicked through too.
- **Exactly one toast fires per delete, and the chaining is what enforces
  it.** A column delete already says "N cards kept on the board" and a
  sub-board link already says "the board is back in the boards list"; the
  undo toast is chained after both with `else`, and the sub-board branch
  had to become an `else if` for the same reason. Unchained, deleting a
  column says two contradictory things at once. `tests/boards.test.js`
  counts the toasts rather than matching one of them — verified by
  unchaining it and watching both cases report 2.
- **The two deletes that are NOT a plain undo stay as they were, and both
  are already honest.** `boardsDeleteColumnAndCards` asks first and puts
  "Ctrl+Z undoes it." in the question, where it belongs. `boardsTrayRemove`
  says **"This cannot be undone"** — and that is true, not a hedge:
  `_boardsPushUndo` snapshots cards and connectors only, and the Unsorted
  tray is saved in `head`. A test asserts the tray confirm does **not**
  promise Ctrl+Z, so a future tidy-up can't make it lie.
- **Provenance says "you" for your own card** — `Added by you · just now`
  rather than your own name read back at you. Uses the bare `session` name
  (`typeof session!=='undefined'&&session`), never `window.session`; see
  the Labels/reactions note for why that distinction has already cost this
  file one silent bug.

Also corrected here: the comment above "Group into Column" still said there
was deliberately no stored column container (Stage 3). That stopped being
true when Column became a real container — a stale comment on a load-bearing
decision is worse than none.

### Mood Boards — the Trash (Sept 2026) — REVERSES M8

M8 shipped a toast INSTEAD of a trash. Afnan then sent Milanote's own trash
panel (rail button at the foot, **Deleted by me / Deleted by others**, day
groups, **Empty trash**) and asked for **both**: "trash should exist and
ctrl + z should result in undo". He is right, and the earlier reasoning was
wrong — the two answer different questions. **Ctrl+Z is "that was a
mistake, just now"; the trash is "where did that card go last Tuesday",
and one keystroke of history cannot answer the second.**

Four decisions hold it together:

1. **A SUBCOLLECTION (`mood_boards/{id}/trash/{entry}`), not an array on
   the board document.** `unsorted` is a plain array because one person
   fills their own tray; a trash has a "Deleted by others" tab *by
   definition*, and the Stage 6 merge is per CARD — two people deleting at
   once would each rewrite a whole array and the later write would silently
   drop the other's entry. One document per deleted card makes concurrent
   deletes independent. It also keeps a growing pile of deleted cards out
   of the document that is rewritten on every autosave.
2. **AN ENTRY IS HIDDEN ONCE ITS CARD IS BACK ON THE BOARD, and nothing is
   written to make that true** (`_boardsTrashLive`). That is the whole
   trick that lets Ctrl+Z and a trash coexist: undo restores the card under
   its own id, the entry stops matching, the row disappears — no write, no
   coupling to the undo stack, and no way for the two to disagree. Same
   discipline as nesting, frame membership and a stale `columnId`.
   Asserted, including that the undo writes nothing at all.
3. **Cards are ENCODED on the way in.** A table's `rows` is a nested array
   and Firestore refuses those outright — the bug that meant table content
   never persisted. A trashed table is the same shape, so it goes through
   the same `_boardsEncodeRows`/`_boardsDecodeCard` boundary. The test
   asserts the **rule** (nothing a trash write produces may nest an array
   in an array), not the field.
4. **The lines come back too.** Deleting a card drops the connectors
   touching it; without them "restore" would quietly return a different
   card from the one that went. They are captured **before**
   `_editConnectors` is filtered — afterwards there is nothing left to
   record — and re-added only where BOTH endpoints are on the board and the
   line is not already there, so restoring two ends of one line, in either
   order, restores it exactly once.

- **A bulk delete is ONE `writeBatch`**, not N round trips. `tests/harness.js`
  gained a `writeBatch` stub (recording into `state.batches` and
  `state.writes`) so both the batch path and its contents are testable.
- **Purge rights mirror `firestore.rules` exactly** (`_boardsTrashCanPurge`):
  your own entry, the board's owner, or an app owner. **Empty trash empties
  the tab you are looking at** and says how many it kept.
- **An entry is never edited** — created and purged only — so the rule has
  `allow update: if false`, like the activity feed.
- **The Unsorted tray still says "cannot be undone", and that is still
  true.** `_boardsPushUndo` snapshots cards and connectors only; the tray
  lives in `head`. A test asserts that confirm does **not** promise Ctrl+Z,
  so a future tidy-up cannot make it lie.
- **The rail's Trash is a DESTINATION, not a Delete button** — M6's note
  said there would never be one precisely because a Trash that only deleted
  the selection would be a second Delete pretending to be a safety net.
  That objection is answered now that deleted cards really go somewhere.
- **`firestore.rules` CHANGED — it needs a republish.**
- **Nobody has looked at the panel in a browser.** ~~The sandbox still cannot
  sign in (gstatic blocked), so the visual is unverified as usual.~~
  *(SUPERSEDED 29 Sept 2026: the gstatic premise is false, and a headless QA session has
  signed in and rendered the Board page — see "Sandbox limits". That run stopped before it
  opened this panel (its report lists no screens), so the panel is still unlooked-at by
  anyone, human or session.)*

### Mood Boards — the rail is a column (Sept 2026)

Afnan, comparing our canvas with Milanote's side by side: theirs runs "along
the whole left side", ours is "not user friendly". Ours was a **floating
rounded pill centred vertically**; Milanote's is a full-height column flush
to the edge with Trash pinned to the floor.

- **It overlays the stage rather than insetting it** — deliberate. The
  stage's bounding rect is what `_boardsScreenToWorld` measures, so leaving
  its geometry alone keeps every pan, zoom, drag and marquee calculation
  untouched. An opaque background hides what pans underneath exactly as a
  real column would.
- **`.rail-grow` pins Trash to the bottom** (a `flex:1` spacer emitted for a
  `{grow:true}` item), and collapses on a phone where the rail is a
  horizontal scroller.
- **The phone dock has to undo more than it used to.** Width, the right
  border and the square corners now come from the desktop rule, so the
  `max-width:560px` block restores all three explicitly — leave one out and
  a full-height column docks to the bottom of a phone.
- **The clipping claim was MEASURED, and the first version of it was
  wrong.** It was first asserted from arithmetic (~13 tools × ~48px vs the
  old `max-height:calc(100% - 40px)`), which is exactly the kind of claim
  this file says not to make. Measured: the rail's content is **~616px**, so
  the old pill overflowed on any stage shorter than **~656px** — a 720p
  laptop once browser chrome and the board's top bar come off. At a 660px
  stage BOTH layouts fit (620 of room for 611 of tools, a **9px** margin),
  which is why the first `smoke-layout` fragment proved nothing. It is sized
  to **640px** now and verified both ways: the old pill reports 616 > 598
  and fails, the column passes.
- **`tests/smoke-layout.js` gained a rail check**: the tool rail must never
  need VERTICAL scrolling. It is navigation chrome, and a tool you have to
  discover by scrolling is a tool nobody finds. Scoped to the vertical axis,
  so the phone dock (sideways by design) is naturally exempt.

**It also exposed a real flaw in the probe itself, now fixed.** The
"text clipped completely out of view" check walked up to the first ancestor
with `overflow-x:hidden` **or** `overflow-y:hidden`, then judged the element
against that box on **both** axes. The phone rail is `overflow-x:auto;
overflow-y:hidden`, so every tool scrolled past its right edge was reported
as invisible — but a **scrollable** axis has not hidden anything, it has
moved it, and it comes back when you scroll. The check is **per axis now,
and only an axis that is genuinely `hidden` counts**. That is the same false
positive recorded under the `+Row/+Col` strip as the reason a fragment could
not hold that ground. Verified both ways: a row pushed entirely above its
`overflow:hidden` panel is still caught.

**And the documented trap caught me writing that comment:** the PROBE is a
template literal, so a **backtick in a comment closes it** and the whole
file stops parsing. Written out again without them.

### Mood Boards — the top bar, regrouped (Sept 2026)

Afnan: "the top menu milanote is polished which ours is not". Ours carried
**thirteen same-weight `tool-btn`s in one row** — Undo, Redo, Find,
Comments, Unsorted, ✋, −, %, +, Fit, Map, Snap, ⋯ — so nothing read as
primary, and **five were already hidden at phone width**, which is the tell
that the row was over capacity at every width.

Milanote splits its header into identity (breadcrumb), the board title, and
actions grouped by kind, with everything about how the board is *looked at*
behind one **View ⌄**. Ours is now
`Undo Redo │ Find Comments Unsorted │ View·100% │ ⋯` — seven controls.
**The Hand toggle left View again in Sept 2026** — see "the Hand tool moves
to the rail"; it is a mode you flip constantly, and a menu row showed its
state only once you reopened the menu.

- **`#board-zoom-readout` keeps its id and moves INSIDE the View button.**
  `_boardsApplyTransform` writes that element on every pan and zoom;
  relocating rather than renaming it is what let that function stay
  completely untouched, and it keeps the zoom reading visible without a
  control of its own.
- **The View menu is the SAME `.board-menu` machinery as `⋯`**, not a second
  popover implementation. `_boardsSyncMenu()` was taught about both, so the
  **eight** existing `_boardsMenuOpen=false;_boardsSyncMenu()` call sites
  needed no change at all. Opening one closes the other — two dropdowns in
  the same corner is the mess this regrouping exists to remove — and a test
  asserts they can never both be open.
- **The outside-click closer had to stop trusting `.board-menu-wrap`.** Each
  menu now lives in its own wrap, so a click inside one must still close the
  other; the old `closest('.board-menu-wrap') → return` left View open while
  you used `⋯`. It keeps the "read the DOM, not just the flag" lesson.
- **Snap is the one View toggle that repaints its own label.** Hand and
  Minimap both call `_boardsRenderCanvasAndWire()`, which rebuilds the menu
  with fresh labels and restores its open state through `_boardsSyncMenu()`;
  Snap does not re-render, and it is a menu row reading "Snap to grid: on"
  now rather than a bar chip whose state was carried by a class.
- **The View menu deliberately does NOT close on its own items**, unlike
  `⋯`. These are view toggles you use in sequence (fit, then zoom out, then
  snap on); the closer returns early for a click inside the same wrap.
- **The `⋯` menu's phone-only Fit / Zoom to 100% / Snap entries are gone** —
  View offers them at every width, and two surfaces for one action is
  exactly what the rail/selection-bar merge exists to prevent. Board
  colour/icon stay there on a phone.

**A real bug fixed in passing: the top bar hardcoded the word "Saved".**
The save indicator was deliberately removed (see "Making it feel instant"),
and `_boardsSetSaveStatus` does render `''` normally — but **nothing calls
it on first render**, so every board opened showing a stale "Saved" next to
its title. Visible in Afnan's screenshot. The span ships empty now.

`tests/smoke-layout.js` gained a top-bar fragment. **Verified both ways** by
covering the bar with a transparent `::after` overlay: the hit-test names
every buried control. That check is the one that matters here — the View
button is now the ONLY route to zoom, Fit, Snap and the minimap, so a View
button the browser cannot click takes all four down with it.

### Mood Boards — level of detail, and the cropped image (Sept 2026)

Two findings from Afnan putting our board beside Milanote's.

**"Zoom out and theirs is readable, ours is not."** The first guess was font
size. It was wrong. **Milanote stops drawing card CHROME as you zoom out and
we drew all of it at every zoom** — verified before changing anything: there
was no zoom-dependent rendering in `js/boards.js` at all.

A card carries a ~26 world-px header strip (type label, name, comment badge,
delete ✕), a border, a shadow, a resize grip and possibly label/reaction/
caption rows. At 22% that header is about **5 physical pixels of grey
banding** across a card barely 40px wide, and every piece of text in it is
under 3px — illegible but still painted, so it reads as mush rather than as
nothing. Milanote's cards at 27% are just the pictures.

- **Three buckets stamped as `data-lod` on `.board-world`** — `far` (<35%),
  `mid` (35–70%), `near`. CSS does the rest: no re-render, no per-card JS.
  It rides `_boardsApplyTransform`, which already runs on every pan and
  zoom, and **the attribute is only written when the bucket CHANGES** so a
  pinch does not thrash the style engine. Asserted.
- `mid` drops the two controls too small to hit (resize grip, delete ✕).
  `far` drops everything but the content, hides text rather than painting it
  illegibly, and flattens the shadow and most of the corner radius.
- **The header stays in the DOM as a thin 10px strip rather than being
  removed** — it is the drag handle for `link` cards, the one type whose
  body does not drag.
- `tests/smoke-layout.js` renders the same three cards at `near` and at
  `far`, and asserts the **contract** (no chrome painted at far, header
  under 12px). **Verified both ways** — deleting one selector fails it
  naming `.board-card-kind`. The fragment also guards the risk in hiding a
  flex sibling: the body grows into its space, which could clip.

**"I pasted the same image into both and ours is cut."** Verified from the
code rather than guessed, and it was neither image size nor Cloudinary.
Card images draw with **`object-fit:cover`, which CROPS to fill**, and an
image card was born 170×120 and **never resized** — while the file branch
*three lines away* always called `_boardsFitPdfCard`. So a portrait photo
showed the middle 170×120 slice of itself. The `image` branch of
`_boardsUploadFileToCard` simply had no fit call.

- **`_boardsFitImageCard(c,res)` mirrors `_boardsFitPdfCard`**, using the
  `width`/`height` Cloudinary already returns. `cover` is KEPT rather than
  swapped for `contain`: once the card matches the picture's ratio, cover
  crops nothing, and `contain` would letterbox every card anyone later
  resizes by hand.
- **A very tall picture brings its WIDTH down with the height cap.**
  Clamping height alone would crop the thing the function exists to stop
  cropping. The floor (`_BOARDS_IMG_MIN`) is deliberately **low (40)** for
  the same reason — set it high and it fights the ratio standing next to it.
  Found by the test: at 80 a 10:1 picture came back at 80×520, re-cropped.
- **All four image paths go through it** — paste, drop-onto-card, the
  add-image panel's stock pick, and the Unsorted tray (which now carries
  `imgW`/`imgH`, free in the upload response). An older tray item without
  them keeps the default rather than guessing.
- The same "someone resized it mid-upload" guard the file path uses.
- `_BOARDS_IMG_W`/`_BOARDS_IMG_H` name the birth size so `_boardsNewCard`
  and the unsized-guard cannot drift apart.

### The Comfortable type scale missed the export canvas (Sept 2026)

Afnan asked me to double-check the board was actually on the Comfortable
scale. The screen is. **The PNG/PDF export was not**, and the reason is
structural rather than an oversight.

The sweep (`e0a0b5b`) applied `f(x) = x<11 ? 11 : x+1` by script, "matching
only a literal `font-size:<number>px`". `_boardsRenderExportCanvas` draws the
board by hand onto a 2D canvas, so every size it uses is a **`ctx.font`
string** — which that pattern cannot match. All **17** were missed and
**7 sat below the 11px floor**, down to 8px.

**They are directly comparable to the CSS sizes**, which is what makes it a
real drift rather than a separate scale: the exporter does
`ctx.scale(scale,scale)` and then translates into **world coordinates**, the
same unit a card's `font-size` uses. Card body text read **13.5px on screen
against 12px in the export**.

Fixed by applying the sweep's own rule to exactly those 17 sites (8→11,
8.5→11, 10→11, 11→12, 12→13, 15→16), scoped to lines containing `ctx.font=`
so nothing else could be touched.

`tests/invariants.test.js` now fails if any `ctx.font` size in
`js/boards.js` drops below 11. **The next mechanical font sweep will miss
these again** — the check is what notices. Verified both ways.

### Mood Boards — the side panels covered the top bar (Sept 2026)

Afnan's screenshots, three in a row, all showed the word **"Comments" cut
off mid-word** by the open Unsorted tray. The tray, the comments drawer, the
card trash and the share modal are all `position:absolute; top:0`, and their
containing block was **`.board-canvas-wrap`** — which is `position:fixed;
top:0`, i.e. the VIEWPORT top. So each of them painted over the top bar.

Fixed with one new element, **`.board-below`** (`position:relative;flex:1`),
wrapping everything under the bar. `top:0` now means "under the bar" with no
magic number, and it survives the bar wrapping onto two rows at a narrow
width. The panels stay **siblings of the stage** rather than moving inside
it: the stage carries `touch-action:none` and the pan/marquee pointer
handlers, and a panel inheriting either would be a different bug.

`tests/smoke-layout.js` renders the top bar **with the tray open** —
verified both ways: dropping `position:relative` from `.board-below` fails
the hit-test naming `Unsorted`, `View 100%` and `⋯` as covered by
`DIV.board-tray-head`.

**That fragment immediately found an unrelated dark-mode bug**, which is
what it is for: `.board-zoom-pill` measured **1.11:1** — near-black on
near-black. Its background is a LITERAL `rgba(0,0,0,.74)` while its ink was
`var(--on-dark)`, which INVERTS. The rule this file already states: *a
literal white is only correct where the background is also literal.* The
pill is that first case, not the second.

### Mood Boards — two bugs in the level-of-detail rules (Sept 2026)

Afnan: "zoom out function is still messy and has bugs as you can see in the
image." Both were mine, both in the CSS shipped one commit earlier, and both
were verifiable from the file rather than from the screenshot.

- **A TINTED card kept its coloured header banding at 22%.**
  `.board-world[data-lod="far"] .board-card-head` is three classes
  (`.board-world` + the `[data-lod]` attribute + `.board-card-head`); so is
  `.board-card-el.tint-green .board-card-head`. **Equal specificity, and the
  tint rules sit ~365 lines LATER in the file**, so they won — which is
  exactly the green band across his WINTER 2K27 card. Forced with
  `!important` rather than reordered: the LOD block belongs beside the card
  rules it modifies, not scattered after every tint.
- **A sub-board card still painted its "Open →" button.** `far` hides
  controls and keeps content, and that button is a control nobody can hit at
  22%. `.board-subboard-title` deliberately STAYS — it is the card's only
  content, and a board link with nothing drawn is a blank rectangle.

The probe now asserts **no card header paints a background at far zoom**,
with a tinted sub-board card in the fragment. Verified both ways: dropping
the `!important` fails it naming `board-card-el type-board tint-green`.

**The general lesson, worth more than either bug:** a `[data-lod]` rule is
class-level specificity, so it does NOT automatically beat the per-card
modifier rules it is trying to suppress. Any future LOD rule overriding an
existing card style needs `!important` or a later position.

### Mood Boards — the preview would not close on the backdrop (Sept 2026)

Afnan: "double clicked on the image to open it bigger but when i click on
the grid to close it does not close, it closes by just clicking on cross on
the top right."

**The handler existed and had never once fired.** It tested
`e.target===wrap`, and the wrap is a flex column **completely covered by its
own bar plus `.board-preview-body`, which is `flex:1`** — so it has no
exposed pixels and that condition is essentially never true. The dark space
around the picture IS the body. Dead since the preview shipped.

`_boardsPreviewBackdrop(t,wrap)` names the rule: the body or the wrap close
it; **the picture, the PDF iframe and the top bar never do** — clicking the
thing you came to look at must not dismiss it. Extracted rather than inlined
so it can be asserted at all: the overlay is built with `createElement` and
`querySelector`, which the node harness stubs out, so the predicate is the
only part testable without a browser.

**A test-suite bug found on the way, worth more than the fix.**
`tests/boards.test.js` had one convention — *the last block returns its
promise* — and the image-fit block I added earlier used `return (async…)()`
**in the middle of the module**, which ends the function and silently drops
every block below it. It had killed the new preview block AND the whole
pre-existing PDF-sizing section. **The only symptom was the assertion total
going DOWN when tests were added** (735 → 728), which is easy to read as a
flaky count rather than dead code. Async blocks now `_pending.push(…)` and
the final block resolves them all: 728 → **759**. **If the total ever drops
after adding a test, look for a `return` in the middle of the module.**

### Card text has its own floor, ABOVE Comfortable (Sept 2026)

Afnan, pointing at a sub-board card's "8 cards" line: "too small cant read
them they are not comfortable… everything should be comfortable to read in
the board."

**The Comfortable sweep was right and still left the board wrong, and the
reason is one sentence: card internals are the only text in this app that
gets multiplied by a ZOOM factor.** Everything inside `.board-world` carries
the board's `scale()`, so an 11px label is 11px *only at exactly 100%*. Afnan
works at **84%**, where 11px renders at **9.2px**. The app-wide floor of 11
is correct for chrome — the rail, the top bar, the panels — because none of
that scales.

**Card-internal text therefore floors at 13px** (~11px at 84%, ~10px at
75%), with the hierarchy lifted above it: body and to-do text 13.5→**15**,
sub-board title 14→**15**, frame title 13→**14**, heading 16→**17**, the
A/B/C coordinate band 11→**13**, and the table cell size attribute (set
INLINE in `js/boards.js`, so no CSS scan sees it) small 12→**13**, large
16→**18**.

**Bigger text in a fixed-height card is the bug class this module keeps
producing, and it produced it again.** `smoke-layout` caught a sub-board
card wearing labels + reactions + a caption where the reactions row painted
straight over the "Open →" button. The fix is the documented one — grow the
CARD: `_BOARDS_CHROME_H` 26/22/26/24 → **28/25/28/27** and
`_BOARDS_MIN_BODY_H` raised across the board. `_boardsTableMinH`'s per-row
estimate moved with it (28→32, big 36→42, header 26→28, band 20→22), or the
`+Row/+Col` strip lands outside the card for the third time.

`tests/invariants.test.js` holds the floor: no `.board-*` card rule under
13px, plus the inline cell size. **Verified both ways** — putting
`.board-subboard-meta` back to 11px fails it by name, which is the exact
line from the screenshot.

### Mood Boards — Home is a board (Sept 2026)

Milanote has no "list of your boards" page: **home IS a board**, and your
boards are cards on it you arrange like anything else. The `boards` page is
that now — `boardsOpenHome()` resolves (or creates) this person's Home and
hands off to the canvas, so every board tool works on the thing that
organises boards.

**The flat list stays, on its own page (`boards-all`)**, reached from
Home's ⋯ menu. That is the Stage 4 safety net, not timidity: a board here is
discoverable by QUERY, never only by a link, so no failed write, no deleted
card and no broken Home can strand one. Milanote can lean on its tree
because the tree is its only truth; ours has a query behind it.

- **Home is an ordinary `mood_boards` document** with `isHome:true`,
  private, owned by that person. **No `firestore.rules` change** — the
  `ownerUid` clause every personal board uses already covers it. Two tabs
  could each create one, so `_boardsMyHome()` picks the **oldest**
  deterministically and the loser is just an empty board.
- **`_boardsHomeSync()` reconciles on open, and the order matters.**
  *Dedupe* first (two devices placing the same board make two cards with
  different ids, and the Stage 6 merge keeps both — nothing can tell it is
  one board twice; running dedupe first stops a duplicate reading as
  "already placed"). Then *prune* cards for boards **positively known to be
  trashed** — never one merely absent from `moodBoards`, because a partial
  load (one of `loadBoardsData`'s three queries failing) would otherwise
  empty someone's Home. **Auto-place is no longer part of it** — see "the
  Boards panel" below, which reverses that.
- **Placement is SAVED, not derived.** One-time per board; after that Home
  is an ordinary board and a card you move stays moved.
- **Sitting on a Home is not "nested".** `_boardsNestedIds` only ever
  follows a real `parentId`, so a board on your Home still lists at root in
  All boards and still reaches everyone else's Home. Same reason, creating
  a board from Home makes a **root** board with a card on Home, not a
  sub-board — nesting it under a board only you can read would drop it out
  of the list for you and nobody else.
- **Deleting a board card on Home TAKES IT OFF HOME** and leaves the board
  alone — it goes back to the Boards panel. It used to ask to trash the
  whole BOARD, which was right while auto-place existed (removing just the
  card was an action that undid itself) and is wrong now; trashing the
  board is **"Move board to Trash…" on the card's right-click menu**,
  owner-only, matching `firestore.rules`. Everywhere else, deleting a board
  card still just unlinks a sub-board. Home itself can't be deleted,
  renamed, shared, templated or made Team, and its top bar drops all of it.
- Back from Home leaves the module (Creative Hub); back from a root board
  goes to Home, or to All boards if that is where you came from
  (`_boardsCameFromAll`).

### Mood Boards — Home's Boards panel (Sept 2026) — REVERSES auto-place

Afnan, from Milanote's home: *"ON Home there should be a tab such as
unsorted ... which is able to hold Public + Private boards, with button to
select public + private board as well"*, plus search-and-scroll-to-it, and
taking a board off Home should return it to the list.

The Unsorted tray grows a **second tab, on Home only** (`_boardsTrayTab`,
per viewer in `localStorage` like the minimap and snap): Unsorted | Boards.
Search (debounced 180ms), an All · Team · Private segment, `+ Team board` /
`+ Private board`, `Place all`, and rows you click or drag onto the canvas.

**THE LIST IS DERIVED FROM THE SAME QUERY THE GALLERY READS**
(`_boardsHomeList`), not a stored holding pen — Unsorted is the opposite
kind of thing (items that exist nowhere else and must be stored), which is
why the two share a panel and nothing else. Everything follows from that:
nothing to keep in step when a board is made on another device or restored
from Trash; "on Home" is derived too (`_boardsHomeCarded`, a card pointing
at that board id); and a board can never be stranded, since the panel, All
boards and the gallery search all read one `moodBoards`.

- **AUTO-PLACE-ON-OPEN HAD TO GO, and that is the load-bearing part.** It
  and the panel answered the same question in opposite directions: a card
  you deleted came straight back on the next visit. That is the *only*
  reason `boardsDeleteCard` used to trash the whole BOARD on Home. It also
  settles the awkwardness the old note recorded — an automatic arrangement
  could not be undoable, whereas `boardsHomePlaceAll` is a button you
  pressed and pushes undo like anything else. `_boardsHomeAutoPlace` is
  still the one implementation, now called only from there.
- **A keystroke repaints THE LIST ALONE** (`_boardsPanelRepaint`). A full
  `_boardsRenderCanvasAndWire()` per character would redraw every card and
  connector on a 46-card board and destroy the input the caret is in — the
  same reason the Find bar does not rerender.
- **Titles are hydrated with `textContent`** (`_boardsPanelHydrate`), never
  interpolated. Someone else named that board and it is drawn into your
  page. The hydrate returns immediately when `#board-panel-list` is absent,
  because it runs on every canvas render.
- **Drag-to-place is pointer-based**, like the tray's drag-out and for the
  same reason: the stage reads a native HTML5 drag as "files from the
  desktop" (`_boardsInternalDrag`). The drop arms `_boardsSuppressClick` —
  the row captured the pointer, so the click that follows is **retargeted
  to it** and would place the board a second time. That is the delete-✕
  retargeting in a new place; it keeps happening.
- **On Home the top-bar button says `Boards` and opens the Boards tab**
  (`boardsToggleBoardsPanel`). A button labelled Boards that opens Unsorted
  is the kind of small lie that makes a UI feel broken.
- **A brand-new Home opens the panel once** (`_boardsHomeFirstRun`) — only
  when Home has no cards at all, and deliberately **not persisted**: a
  first-run nudge, not a setting. Without it, retiring auto-place leaves a
  new person on an empty canvas with nothing saying where the boards went.
- A row names the owner **only when it isn't you**. Private covers both
  your own boards and ones shared with you, since all three of
  `loadBoardsData`'s queries land in the same `moodBoards`.
- `tests/boards.test.js` covers it (32 assertions) and
  `tests/smoke-layout.js` gained a fragment — **verified both ways**:
  dropping `min-width:0` from the row's info column fails it, naming the
  overflowing row and the covered Open button, which is the Profile
  directory's shape exactly.

**Found while doing this, already red on `main`:** the assertion "the
markup carries no cell text" searches the WHOLE table card's markup, and a
card id carries `Date.now()` — `1789724573410` contains the digits `245`,
which is the cell value the test looks for. Diagnosed by printing the match
and its context, not by re-running until it passed; the id is pinned now.
**Any assertion that greps rendered markup for a short string has this
shape** — scope it, or pin whatever carries a timestamp.

### Mood Boards — Home's panel, rebuilt to Milanote (Sept 2026)

Afnan, with ours beside Milanote's: the panel *"should be wider and always
open and a funtion to soft close"*, a board should be read by its **picture**
and its **whole name**, you should be able to set that picture yourself
(upload or text), assign a colour with a picker, and the Team/Private split
and the search should stay but improve.

**Most of it already existed, and finding that was the first job.** Colour,
icon, rename, duplicate, template, Team/Private and Trash have been on the
gallery's right-click menu since it shipped, behind `_boardsGalleryCtxRun`,
which acts on a board **by id** — exactly what a panel row is. So the row's
`⋯` and its right-click open **that** menu rather than a second one. Picture
and colour arrive in both surfaces at once and cannot drift. That is the
rail-and-selection-bar mistake, not repeated.

Four real gaps were left:

1. **A board PICTURE (`b.coverUrl`), and then one sheet for the whole
   tile.** Afnan, on the next pass: double-clicking the picture should
   offer colour, upload an image, assign text, assign a number "however
   someone wants it". **Four ways to fill one tile belong on ONE sheet**
   (`boardsOpenBoardLook`), not behind four menu entries whose names you
   have to know — a person choosing how a board looks is comparing them,
   not picking a command; Milanote's own panel does the same
   (Recommended · Letters & numbers · Upload an image). **They all write
   the same two fields:** a letter, a number and an emoji are all
   `b.icon`, a short string the tile already rendered, so "assign text"
   and "assign number" needed **no new field and no migration**. The
   sheet reopens after each choice, so trying three colours is not three
   round trips, and Custom colour still hands off to the existing HSV
   sliders rather than a second implementation. The gallery menu's four
   entries collapsed into one (`g:look`) for the same reason.
   `b.coverUrl` itself: `_boardsTileHTML` takes an uploaded
   picture, then an emoji icon, then the first letter — a board always has
   a tile and nothing migrates. **Only an ANCHORED
   `https://res.cloudinary.com/` URL is accepted** (`_boardsCoverUrl`): the
   string goes straight into an `<img src>`, and `res.cloudinary.com.evil.test`
   must not pass. Same rule as `_profPhotoUrl`, duplicated rather than
   shared because `profile.js` loads AFTER this file. **Cloudinary's own
   answer is re-checked before it is written** — that is the moment not to
   trust a URL, not the moment to relax.
2. **Always open, with a SOFT close.** On Home the panel is always in the
   DOM; Close **collapses** it to a rail carrying the board count and the
   way back. That is what makes it soft — it does not vanish, and returning
   is one click on something visible. Per viewer in `localStorage` like the
   minimap and snap, defaulting to **expanded**, because a panel that
   remembered itself shut would quietly undo "always open". A paste
   un-collapses it: collecting into a panel nobody can see is the bug the
   paste round just fixed.
3. **The row.** 404px, a 58px picture, and the **whole name** on its own two
   clamped lines, meta under it, actions on a line of their own. **The name
   never shares a row with a button** — the Profile-directory rule, which
   the 280px version broke exactly as that rule predicts: 30px of tile plus
   a state word plus Open left nothing, and it rendered `WINTER D…`. A wider
   panel alone would have postponed that, not fixed it.
4. **The panel INSETS the stage** (`.board-below.with-panel`), on Home only.
   Overlaying is right for a tray you open for a moment — it is what the
   tool rail deliberately does — but a permanent 344px curtain would also
   make **Fit fit the board to a width part of which nobody can see**:
   `_boardsFitView` measures the stage rect, so shrinking the stage is what
   makes Fit honest. Every pan/zoom/drag reads that rect live, so nothing
   else changes.

- **Search reaches CARD TEXT** now, through the same `_boardsMatchCount` the
  gallery search uses so the two cannot disagree about what "matched" means,
  and a row that matched on its cards rather than its name **says how many**
  — a row appearing for a word that is nowhere on it reads as a broken
  filter.
- **`_boardsRerenderGallery` learned about Home.** Every identity change is
  reachable from the panel now, and without that branch the menu appeared to
  do nothing there: the write landed and the tile kept its old picture until
  the next render. The dead-button shape, again.
- `window.boardsToggleBoardsPanel` was deleted rather than left beside
  `boardsTogglePanel`.
- **Double-click the NAME to rename in place**, double-click the **TILE**
  for the look sheet. **Both swallow their own single click as well as
  `pointerdown`** — without that, double-clicking an *unplaced* board would
  PLACE it on the way to renaming it, and the row's drag would start under
  the caret. Enter or blur saves; Escape restores the name captured
  **before** the field opened, so a cancel cannot write back something
  half-typed. **The gallery renames in place too since 28 Sept 2026**
  (`_boardsInlineRename`, which stops the tile's click while the title is
  being edited — see "Milanote: no browser dialogs" below).
- **The left rail and the card menu carry Picture and Board name** for a
  selected board card, routed to the same sheet and the same gallery
  router — the rail and the menus cannot offer different things.

**TWO lessons about verifying, both worth more than the feature.**

The layout fragment was checked by putting the name back on a shared flex
row in a 280px panel — and **the first attempt at that break did not apply**
(a multiline string mismatch) and reported a clean pass, which reads exactly
like "the fragment has no teeth". **Confirm the break actually landed before
believing either answer.**

Worse: making the name clickable turned it into a control the probe
hit-tests, which reported it as zero-size — and that is how it came out that
**the fragment had never measured a real board name at all.**
`_boardsPanelHydrate` walks `document.getElementById`, and **the harness's
DOM does not parse an `innerHTML` string into findable elements**, so
calling it there does nothing and every row was measured EMPTY. The fragment
had been claiming to prove "the whole name is visible" while measuring blank
boxes. **Any fragment whose module hydrates text with `textContent` must
fill it in the REAL browser**, the way the link-preview and far-zoom
fragments do — calling the hydrate from the harness proves nothing.

**And the CACHE_VERSION collision happened again, in its dangerous form.**
Ammar's PR #77 shipped `v108`; this work picked `v108` too. The merge was
clean and **`sw.js` was not in it at all** — both sides had written the
identical line, so git had nothing to resolve while the two builds are
entirely different bytes. `tests/check-cache-version.js` caught it. Bumped
past both to **`v109`**.

### Mood Boards — the zoom floor is 25% (Sept 2026) — REVERSES parity

Afnan, with a screenshot at 26%: *"zoom problem not fix yet, lock zoom out
at 25%."* This reverses the Milanote-parity round that took the floor
10% → 5%.

**Below 25% a card is a smudge.** The level-of-detail rules already strip
every piece of chrome under 35% precisely because none of it is legible
there, and past a point the picture goes too — a floor you cannot read past
is not a feature. Milanote can afford 5% on a 398-card board; ours are tens
of cards, where Fit brings the whole board on screen well above this.

- **`_boardsClampZoom` is THE one place the range is enforced** — all five
  zoom entry points and, new, the board **OPEN path**. Without that last
  one a board saved at 19% (every board Afnan has worked on) would come
  back below the floor and stay there, with nothing on screen to say why
  zooming out did nothing.
- **Fit is clamped too:** on a board too wide to fit at 25% you get 25% and
  a pan, not an unreadable whole-board view.
- The `far` LOD bucket is now the 25–35% band. Narrow, and still exactly
  where Afnan's screenshot sits.

**A LIVE BUG THE TEST FOR THIS WALKED INTO, and it is the more important
half.** Writing a test that opens a board *for real* surfaced that
`_boardsOpenCanvas` calls **`_boardsCardTrashStart(b.id)` — a function that
has never existed.** The real one is `_boardsTrashStart`; the Trash round
renamed the STATE (`_boardsTrash` was already the gallery's trashed boards,
so the card trash became `_boardsCardTrash`) and this call site followed the
state instead of the function.

It threw a `ReferenceError` on **every board open** since. Nothing looked
wrong, because the canvas renders on the line ABOVE it and
`_boardsOpenCanvas` is dispatched from `renderPage` with no `.catch` — so it
silently skipped the four things below it:

- **the card Trash never loaded its entries** (its `onSnapshot` is that call);
- the per-board **activity feed** never started;
- a board opened **cold from a deep link** never refreshed its breadcrumbs
  and sub-board titles once the list landed — and **Home never ran its
  sync**;
- a `#board=…&card=…` link **never focused its card**.

`node --check` cannot see this; the file parses perfectly. `smoke-browser`
cannot either, because it never opens a board. So
`tests/invariants.test.js` now checks that **every `_boards*` helper CALLED
in `js/boards.js` is also DEFINED there** (406 defined, 339 called).
Verified by putting the wrong name back: the invariant names it and the
board-open test throws on it.

**That scan deliberately does NOT strip comments first.** Stripping them is
what corrupts it — a `/*` inside a string or a regex literal eats the rest
of the file, and it silently hid ten real definitions when this was written.
Reading comments too only risks a name mentioned in prose and defined
nowhere, which is a rename to make in the comment.

### Mood Boards — paste always collects (Sept 2026) — REVERSES Stage 1

Afnan: *"make paste always collect into unsorted"*. `Ctrl+V` goes to the
Unsorted panel whether or not it is open, the way Milanote's does.

**The rule this reverses existed for a reason, and the reason is answered
rather than dropped.** An open tray was the visible statement that you were
collecting, so with it shut a paste that vanished into a panel nobody could
see would be indistinguishable from a paste that did nothing. So collecting
**opens the panel** (`_boardsCollectInto`) on its **Unsorted tab** — on Home
it may have been left on Boards, where the new item would not be on screen
at all, so the tab is switched too. Both are persisted: you were collecting,
and the next paste should land somewhere you are already looking.

**Placing directly is still one gesture away: right-click where you want it
→ Paste.** That is the one paste that carries a location, which is what makes
it the right home for the old behaviour.

**THE REORDERING IS THE LOAD-BEARING PART, and it fixed a live bug.** The
tray branch ran FIRST, above the copied-cards and copied-lines cases — so
**with the tray open, `Ctrl+V` of cards copied from a board made a NOTE
holding the raw tagged JSON**. That quietly broke the Stage 2 rule ("the
paste handler checks the prefix **before** its URL/plain-text cases") the day
the tray shipped, and making every paste collect would have made it happen to
everyone, every time. `_boardsPasteClipCards` runs first and returns true
**even when the payload is unreadable** — falling through would collect our
own JSON as somebody's note.

- **Two things still outrank the panel, both because they name a target:**
  an image with a single EMPTY image card selected fills that card, and an
  image still beats an editing caret (Stage 1 — pasting one into a
  `contenteditable` does nothing useful anyway).
- Text pasted while editing belongs to the card, and the guard is
  `_boardsIsEditableFocus()`, so it covers an `<input>` too — **a URL typed
  into the Boards panel's search box is not collected.**
- **`_boardsTrayPaste` is gone rather than left beside the new path.** Two
  paste implementations that disagree is the exact class of bug this
  produced; there is one now, split into `_boardsCollectInto` +
  `_boardsTrayAddText`.
- `tests/harness.js` gained **`requestAnimationFrame`**, deferred rather than
  inline: `_boardsRenderSoon` coalesces through it, and a synchronous
  callback would re-enter the render in the middle of the call being tested.

### Mood Boards — link previews (Sept 2026)

Afnan, with our board beside Milanote's: a URL pasted there lands as a
picture with a title and a description; ours landed as three empty form
fields. **This is the follow-up Phase 2 flagged and told us not to ship
casually**, and the reason is the whole design: the browser CANNOT read
another origin's HTML for `og:image`/`og:title` — that is precisely what
CORS forbids — so the fetch happens on a server, and **a server that
fetches a URL somebody typed is a Server-Side Request Forgery hole** until
every one of these is closed. `netlify/functions/link-preview.js` closes
them; read its header before touching it.

- **The hostname is RESOLVED and every address checked before the fetch** —
  loopback, `10/8`, `172.16/12`, `192.168/16`, CGNAT, multicast, v6
  unique-local and link-local, `::ffff:` mapped v4, and **`169.254.169.254`,
  the cloud metadata address, which is the one that actually matters**. Not
  a blocklist of hostnames: a DNS record you control evades that in one
  step.
- **REDIRECTS ARE FOLLOWED BY HAND AND EVERY HOP RE-VALIDATED.** This is the
  case a naive check misses entirely — a public URL that 302s to
  `http://169.254.169.254/` walks straight past a single up-front check.
  **Proven by reverting it**: the test then reports the private address was
  requested.
- http/https only, no credentials in the URL, no `localhost`/`*.local`; an
  8s timeout, a 512 KB cap read off the stream, a content-type check, and a
  verified Firebase ID token — any signed-in user of this app, so it is not
  an open fetch proxy for the internet.
- **The HTML is never returned.** Four length-capped strings: title,
  description, image URL, site name.
- **Residual risk, stated rather than hidden:** it resolves the name and
  then fetches by name, so a DNS rebind between the two is not prevented.
  Pinning to the resolved IP means a TLS servername override undici's
  `fetch` does not expose, and the prize for winning that race is one page
  read back through a response already stripped to four strings. **Do not
  widen what comes back without revisiting that.**

Client side (`js/boards.js`):

- **The picture is RE-UPLOADED TO CLOUDINARY, never linked hot** — the same
  call the stock-photo picker makes (M7), for the same three reasons: no
  permanent dependency on a stranger's host, no tainted export canvas the
  first time one sends no CORS header, and the sized derivatives every other
  board image gets. A picture that fails to mirror costs the picture, not
  the card.
- **Nothing is on the critical path.** The card appears at once with the
  bare URL; the preview arrives and re-renders. A site that refuses, times
  out or carries no `og:` tags leaves exactly the card we had before.
- **Title, description and site name are hydrated with `textContent`** — the
  most obviously third-party strings in this file. Same boundary as card
  text, comments and to-do items.
- **`_boardsApplyLinkMeta` is PURE and separate from the fetch**, so the two
  judgement calls are assertable without a network: a title somebody typed
  is **never** clobbered (the paste path seeds the HOST, so only a title
  still equal to that is ours to replace), and only a card still at its
  birth size is resized (`_boardsLinkCardUnsized`, the image/PDF guard).
- **`_fetching` / `_linkEdit` / `_linkNoPreview` / `_linkFetched` are all
  `_`-prefixed**, so a save firing mid-fetch cannot persist "Loading
  preview…" the way `_uploading` once persisted "Uploading…".
- **A preview card drags from its BODY**, like an image or file card. That
  narrows the header-only rule rather than overturning it: the rule is for
  bodies holding a caret, and the edit form keeps its own.
- **Typing does not fetch** — `Done` does, and only when the URL actually
  changed. A fetch per keystroke against a half-typed address would be a
  server request per character.
- **The Unsorted tray gets the same treatment**, which is what Afnan's
  Milanote screenshot actually shows: a collected link is its picture, not a
  grey LINK box. Dragging it out carries the preview rather than fetching it
  a second time.
- PNG/PDF export draws it, through the same preloader
  (`_boardsExportImageUrl`).

**Found on the way, both invisible:** `.board-world[data-lod="far"]
.board-link-desc` has **never existed** — the class is `.link-desc` — so
that level-of-detail rule had no effect and no symptom, which is exactly why
the far-zoom probe asserts the contract rather than trusting the rules. And
`.link-title`/`.link-desc`/`.link-url` are card-internal (multiplied by the
board zoom) but do **not** start with `.board-`, so the 13px card-text floor
never saw them and `.link-url` was still at 11px. The invariant covers them
now.

`tests/link-preview.test.js` (57 assertions) holds the function; the layout
fragment catches **a fixed image height pushing the title and URL out of the
card**, which is the real risk — the first thing I claimed it caught (a
crushed text block) is not a bug and did not fail it.

**The card anatomy, second round.** Afnan, with the first cut on screen: the
URL should be shown, the link should be orange so it reads as clickable and
clicking it should open the site, and there should be a small button to show
or hide the picture. Rows are **URL · TITLE · description** now, Milanote's
order.

- **The title IS the link** — an `<a target="_blank" rel="noopener
  noreferrer">` in a new **`--link-accent`** token (orange, inverting for
  dark exactly as `--dark` does). **The `rel` is not decoration:** without
  it the opened page can reach back through `window.opener`.
- **`_boardsSafeHref` — only `http`/`https` reaches the attribute**, and
  when it refuses the `<a>` is emitted with **no href at all**, which
  renders as plain text. `_boardsEsc` escapes quotes but would pass
  `javascript:alert(1)` straight through, and this string came off a
  clipboard.
- **The anchor stops `pointerdown` reaching the drag handler**, or the card
  would move instead of the link opening — the pointer-capture retargeting
  that has now cost the delete ✕, the file card, a table cell and this.
  **Fourth time.**
- **The URL row is the Profile-directory shape**: a fixed glyph, the
  flexing address (`min-width:0`, ellipsized) and a fixed toggle. Get the
  `min-width:0` wrong and the address crushes the button to nothing.
- **The show/hide toggle is stored ON THE CARD** (`linkPreviewOff`), not per
  viewer: a board is looked at by several people, and a card that is a
  picture for one of them and three lines of text for another is two
  different cards. It resizes only a card still at one of our two sizes.
- The layout fragment carries a card **at the smallest size a link card
  gets, WITH a picture**, so the toggle is measured on the card whose resize
  grip is nearest it. **Verified by moving the toggle into that corner** —
  it fails, naming `svg.board-resize-handle`.

**CONFIRMED WORKING ON THE LIVE SITE by Afnan, 18 Sept 2026** — a real
paste, a real page, a real preview. That matters more than usual here: ~~the
sandbox cannot reach any external site, so~~ *(SUPERSEDED 29 Sept 2026: many external hosts
answer from a session — "Sandbox limits" table; whether the link-preview function has since
been run against a real page from a session is not recorded here)* the server fetch, the `og:`
parsing and the Cloudinary mirror could only ever be exercised against a
scripted `fetch` from a session. **Do not re-open the fetch path on a
hunch** — if a preview comes back empty for one site, that is that site
(no `og:` tags, a bot block, a timeout), not this code. The card still
works and **Refresh preview** is on its right-click menu.

**Two defects in the probe itself, found here.** Its far-zoom fragment never
hydrated its link cards, so an empty `<a>` was a genuine 0×0 box reported as
an unreachable control — the fragment measuring itself. And
"something else is covering this control" named the coverer as
`[object SVGAnimatedString]`: `className` on an SVG is not a string, and what
sits on top is usually an **unclassed** `<svg>` inside a classed wrapper. It
reports the tag plus the nearest classed ancestor now. **And the documented
trap caught me writing that comment: a backtick in the PROBE closes the
template literal.**

### Mood Boards — attachments: preview and download (Sept 2026)

Afnan: Download opened a Chrome error page (`ERR_INVALID_RESPONSE`), Open
showed "Failed to load PDF document". Both were `window.open()` on a
Cloudinary URL — **navigating to an asset hands the whole outcome to the
browser**, so you get Chrome's error page with nothing to act on.

**Milanote's preview is not a custom renderer — it is the browser's own PDF
viewer in an iframe**, which is where its page thumbnails, page counter,
zoom, rotate, print and download come from. So `_boardsOpenPreview` fetches
the bytes once and hands the browser a **blob: URL**. Three things at once:
the same native viewer with no new dependency (pdf.js is one); a Download
that opens the real Save-as dialog under the **card's** name (an
`<a download>` pointing at a **cross-origin** URL is ignored by Chrome — a
`blob:` one is honoured); and a readable error, because a failed `fetch`
has a status.

**The cause was Cloudinary's account setting, and it is now CONFIRMED.**
PDF and ZIP delivery is off by default on a free Cloudinary account, so
`res.cloudinary.com/<cloud>/image/upload/…​.pdf` answered with an error body
instead of the file — hence Chrome's "Failed to load PDF document", and
`ERR_INVALID_RESPONSE` on the `fl_attachment` URL. Afnan turned it on
(Cloudinary console → the **gear** icon at the foot of the left rail →
**Settings → Security** → *Allow delivery of PDF and ZIP files*) and Open
and Download both work. **Do not re-diagnose this from the code** — nothing
in `js/boards.js` was ever wrong about the URL.

The tell, worth reusing: **the card's page-1 thumbnail rendered perfectly
the whole time.** That is Cloudinary rasterising the exact document it was
refusing to serve, which rules out a bad upload, a bad URL and a broken file
in one observation. ~~The sandbox cannot reach `cloudinary.com` at all — the
egress proxy answers `403` to `CONNECT` for the docs and support sites too,
not just `res.cloudinary.com` —~~ *(SUPERSEDED 29 Sept 2026: `cloudinary.com/documentation`
200, `support.cloudinary.com` 302 and `res.cloudinary.com` all answer from a session)* so this
was reasoned from screenshots and then confirmed by the human, which is still the only route
for the account SETTING itself (it needs the account's login).

On a 401/403 for a PDF the preview still names that setting, so if the
account is ever changed or a second environment is set up, the app says what
to check instead of showing a browser error page.

Double-clicking an image or file card previews it; a plain click on a file
card no longer navigates (ctrl/cmd-click still opens a tab). The right-click
menu's Download and Open route through the same two functions as the card's
own buttons, so the two cannot drift apart.

### Mood Boards — one download per card (Sept 2026)

Afnan: the Save-as dialog took a while, so he pressed Download again and the
file arrived twice.

**CONFIRMED WORKING ON THE LIVE SITE by Afnan, 18 Sept 2026** — *"imagien
download thing is solved"*. The guard, the cover and the progress text all
behave on real files. **Do not re-open `_boardsDownloadAsset` on a hunch.**
The still-OPEN question is the separate one below — whether
`fl_attachment:<name>` preserves a chosen filename — and that is untested
against Cloudinary, not broken.

**WHY IT WAITS is structural, not a bug.** An `<a download>` pointing at a
**cross-origin** URL is ignored by Chrome — it navigates instead — so the
only way to hand the browser a filename WE choose is to fetch the bytes and
make a **same-origin `blob:` URL** out of them. The dialog cannot appear
until the whole file has arrived. The card also shows a **sized derivative**
while the download takes the **original**, so nothing is warm in the cache
either. **Holding the bytes is what buys the name; the wait is the price.**

**There IS an instant path, and it is NOT shipped because it could not be
verified.** Let Cloudinary send the file with `Content-Disposition:
attachment` (`fl_attachment`, already in this file as the last-resort path)
and navigate to it: the browser streams it and asks immediately. The cost is
the filename — it becomes Cloudinary's `public_id` unless
**`fl_attachment:<name>`** works, and ~~the sandbox cannot reach
`cloudinary.com` to check~~ *(SUPERSEDED premise, 29 Sept 2026: `res.cloudinary.com` answers
from a session; this was not tried, so it is still untested)*. **Ask the human to open one such URL before
shipping it**; do not guess the syntax.

What shipped instead:

- **A GUARD.** One download per card at a time, keyed on the card **id**, so
  the same file reached from the card button, the rail and the right-click
  menu is still one download. The second press is refused **out loud** with
  a toast — silence is what caused the report. Released in a `finally` on
  every path; a card left permanently "downloading" would be worse than the
  bug.
- **A COVER** on the card (`.board-card-busy`), built with `createElement`
  when a download starts: a translucent wash, an animated sweep, suppressed
  under `prefers-reduced-motion`.
- **REAL PROGRESS where the response allows it.** `_boardsFetchAsset` reads
  through the **stream** when a caller is listening AND there is a
  `Content-Length` to measure against. No length or no readable body →
  straight back to `blob()` and the sweep carries it: **a number that cannot
  move reads as a hang.**
- **IT SWALLOWS NOTHING** (`pointer-events:none`). The guard is the
  enforcement; the cover is the explanation. A cover that ate the click
  would make the second press do nothing at all — the exact silence being
  fixed — and it leaves the card selectable and draggable meanwhile. The
  layout probe hit-tests that: making it `pointer-events:auto` fails naming
  the delete ✕ and the file card's own buttons.
- **Known limit, written down:** the overlay and its text node are held by
  card id rather than re-queried per chunk, so a **structural render**
  rebuilds the canvas and the held node goes with it — the cover disappears
  while the download carries on. The download still completes and the guard
  still holds.
- `tests/harness.js` gained **`click()`** on its element stub: a synthetic
  `<a>` is how a blob download is triggered, so without it this path could
  not be exercised at all.

### Mood Boards — a PDF card is sized to its page (Sept 2026)

Reported with a screenshot: an attached production brief landed as the
200×110 file default, and the name row plus Open/Download took ~90px of it,
so the page-1 thumbnail was a **198×30 strip** (measured in Chrome with the
real `css/main.css`). Every PDF had to be dragged open by hand.

- **A PDF card is 240 wide and as tall as its page** (`_boardsFitPdfCard`,
  `_boardsPdfCardH`). The ratio comes from Cloudinary's upload response
  (`width`/`height`), with **A4 portrait** when it has none. The chrome
  constant (`_BOARDS_FILE_CHROME_H` = 92) was **measured, not estimated**:
  the first guess of 96 left the thumbnail 4px taller than the page.
- **Only an unsized card is fitted** (`_boardsFileCardUnsized`): the file
  default, or the A4 placeholder below. A card resized while its upload ran,
  or resized before a Replace, keeps its size. The size at upload start is
  captured before the `await` and compared after it.
- **`_boardsAddFiles` gives a PDF its A4 size before uploading**, so the
  "Uploading…" card doesn't jump, and the drop grid now steps by the
  **largest** card in the drop — with per-card steps a PDF beside a small
  card overlapped the next row.
- **A PDF stored as a RAW resource goes back to the compact card.**
  Cloudinary cannot rasterise raw files, and a page-sized card around a
  thumbnail that will never load is worse than the default. A failed upload
  shrinks the placeholder back the same way.
- Dragging a PDF out of Unsorted gives it A4 size (a tray item stores no page size).
- **Existing cards are not touched.** Resizing them on open would write to
  every board that has one; drag the corner instead.

### Mood Boards — the QA retest (Sept 2026)

Afnan retested the round above on the live site. Three fixes held (Line
mode default, heading edit, the file card opening a tab); three findings
came back, and all three were real. Each was invisible to every existing
suite, which is why a human found them and CI did not.

- **"Missing board" was unfixable, not just broken.** The c15cd05 fix stops
  the rail minting a `type:'board'` card with no `boardId`; it does nothing
  for the orphans already sitting on real boards, which render the fallback
  title *and* a dead "Missing board" line with no Open button. A card that
  is a LINK to something must either link to it or **offer to create it** —
  `boardsRepairBoardCard` adopts the orphan (same two writes as
  `boardsAddChildBoard`, flushed not debounced). A `boardId` this viewer
  genuinely cannot read now says why instead of offering an Open button that
  no-ops, and `boardsGoto` refuses an unloaded board out loud.
- **The caption "never saved" because you could never type in it.** It is
  `contenteditable="false"` like every card body, and only a double-click
  switched it on — but a caption is not a drag surface (it sits OUTSIDE the
  body div, has no drag handler) and its placeholder reads "Add a
  caption…", which promises a field. **One click opens it now.** The
  double-click rule exists for bodies that a drag would fight; don't apply
  it to things that just look like inputs.
- **Labels and reactions were eating the card body, not overlapping it.**
  They are flex rows in the same column as the body. On the default 104px
  sub-board card, one label plus one reaction left ~50px with
  `justify-content:center` — and content taller than a *centred* flex box
  spills out of **both** ends, so `overflow:hidden` erased the top one and
  the title was painted nowhere. The fix grows the **card**
  (`_boardsMinCardH`), used by the render AND the resize clamp, so cards
  written small before this display correctly with no migration and no
  write; adding a label/reaction/caption raises the stored `c.h` so it
  catches up. Overlaying the rows would have been the same bug with extra
  steps.
- Resize grip 24px → 30px (34px on phones). A duplicated
  `.board-resize-handle svg` rule was silently overriding the 13px glyph
  size the rule three lines above it asked for.

**`tests/smoke-layout.js` grew the check that would have caught the third
one**: text laid out entirely outside its nearest clipping ancestor. The
zero-size checks miss this completely — the element has a perfectly good
rect, it just isn't one anybody can see. It requires **no intersection at
all**, so a long note whose last lines are cut off is not a finding.
Verified both ways: with the height fix reverted it fails and names
`board-subboard-title`.

### Mood Boards — Milanote parity (Sept 2026)

From the teardown a browser-capable session ran against the real Milanote.
Shipped: zoom floor **10% → 5%** (Milanote's own — **reversed to 25% in
Sept 2026**, see "the zoom floor" below); **Fit and 100% are one
context-aware button** (the fitted state is derived in
`_boardsApplyTransform` rather than cleared at each zoom/pan entry point, so
a new entry point inherits it); a **file count on gallery tiles** ("398
cards · 14 files"); **explicit Open and Download buttons on file cards**
(both carrying the `onpointerdown` guard — a control inside a drag surface
whose pointerdown reaches the handle has its click retargeted away, the
delete-✕ bug; and the `<a>` can no longer wrap them, which is invalid and
would win the click anyway).

**The whole-board `cards` array is staying, and this was measured rather
than argued.** An engineering spec written from the teardown recommended
per-card records as "the single most important choice", and the strongest
case for it was Firestore's 1 MiB document cap against the 398-card board
Afnan actually has in Milanote. Measured with representative cards built
from `_boardsNewCard`'s real shape (3 image : 1 text : 1 file : 1 frame,
real Cloudinary URLs, labels, reactions, rich text): **~364 bytes a card, so
398 cards is ~0.15 MiB — 15% of the limit**, and the ceiling is somewhere
near 2,600 cards. The cap is not the constraint it was assumed to be. What
per-card records would actually buy is smaller writes (a 150 KB document
rewritten on each autosave), and that is a bandwidth question, not a
correctness one. Re-measure before reopening this; don't re-derive it from
the same assumption.

**Every gap on this list has since shipped** — Column as a true container,
Home-as-a-board, Table, linear document export and Presentation each have
their own section above. What is deliberately still missing versus
Milanote: board **backgrounds**, and a typed/schema'd table (see the Table
note for why the untyped one came first).

### Mood Boards — drag to select (Sept 2026)

Afnan asked for Milanote's gesture: **dragging empty canvas draws a
selection box.** This REVERSES the Stage 2 decision above, so the thing
that had to be got right is the reason Stage 2 chose the other way — this
canvas has no scrollbars, so if dragging stops panning, someone who never
finds the alternative is stranded in one corner of a board.

**There are four ways to pan, and the first two need nothing discovered:**

1. **The wheel / two-finger trackpad scroll** — shipped a few commits
   earlier for an unrelated bug, which is what made this reversal safe to
   make at all. No modifier, no mode, works immediately.
2. **Dragging on a TOUCH screen still pans.** A phone has no Shift key and
   rubber-banding with a finger is miserable; Milanote's own phone view
   pans on drag too. The branch keys off `e.pointerType==='touch'`.
3. **Space + drag**, the convention in every design tool. Held at the
   document level, ignored while `_boardsIsEditableFocus()` (space is a
   space), and **cleared on `window.blur`** — alt-tabbing away mid-hold
   would otherwise leave the board stuck in pan mode with nothing on
   screen to say why.
4. **The ✋ Hand toggle** in the toolbar, and **middle-button drag**
   (which `preventDefault`s to stop Chrome's autoscroll).

**Shift+drag still marquees**, so nobody's muscle memory breaks. The
stage's resting cursor is `crosshair` and becomes `grab` whenever a pan
route is armed, so the current gesture is always visible.

Also added, from the selection menu and rail in Afnan's screenshots:

- **Connect with Lines** — connects the selection in sequence. Selection
  order is insertion order (it is a `Set`), i.e. the order you clicked, the
  only non-arbitrary order available. It **skips a pair that is already
  connected in either direction**, so running it twice on a group does not
  silently double every line.
- **Align** (6 ways) and **Distribute** (h/v). Distribute evens the **gaps,
  not the positions** — spacing by left edge looks wrong the moment two
  cards differ in width, which on a real board is always. Both skip locked
  cards, align needs 2+, distribute needs 3+ and the menu hides it below
  that. They route through `_boardsCtxRun`, so the rail and the right-click
  menu get them together and cannot drift apart.

Already present and unchanged, since Afnan asked about them: dragging a
card that is part of a selection moves the whole group
(`boardsCardDragStart`), Delete/Backspace deletes the selection, and the
right-click menu already carried Cut / Copy / Duplicate / Delete / Lock /
Bring to front / Send to back — the same set Milanote shows.

### Mood Boards — the wheel and the native drag (Sept 2026)

Two bugs Afnan reported from his PC, both verified from the code before a
line was changed.

- **Ctrl+wheel zoomed the BROWSER, not the board.** There was no `wheel`
  handler in `js/boards.js` at all — grep it and you find only a CSS class
  name — so the event fell straight through to Chrome's page zoom and
  scaled the top bar, the rail, the minimap and the Report Bug button along
  with the canvas, while the board's own readout sat unchanged at 40%.
  Now: a **non-passive** `wheel` listener on `.board-stage` (passive and
  `preventDefault()` is ignored, so the page zooms anyway — that call IS
  the fix). Ctrl/Cmd+wheel zooms about the **cursor** via
  `_boardsZoomAtPoint`, exponentially so a step feels the same at 19% as at
  200%, clamped per event so a coarse mouse wheel can't jump three steps.
  A trackpad pinch reaches Chrome as a wheel with `ctrlKey` set, so it is
  the same branch. Plain wheel **pans** (shift swaps the axis) — a canvas
  with no scrollbars should. A second listener on `.board-canvas-wrap`
  catches Ctrl+wheel over the top bar and rail, skipping anything inside
  the stage or the zoom would apply twice.
- **Dragging a card raised the file-drop overlay instead of moving it.**
  Card images carried no `draggable="false"`, so grabbing one started a
  **native HTML5 image drag** — which both cancels the pointer stream our
  card drag runs on and, because **Chrome advertises a dragged `<img>` to
  the drop target as carrying `Files`**, raised "Drop files to add them to
  this board". Afnan's words were "it's mixing 2 logics", which is exactly
  right. Fixed at three levels: `draggable="false"` on every card image and
  on the file card's `<a>` (an `<a href>` is natively draggable too);
  `-webkit-user-drag:none` in `css/main.css` for anything that grows an
  image later; and `_boardsInternalDrag`, set on a `dragstart` inside the
  stage and cleared on `dragend`/`drop`, which makes `_boardsDragHasFiles`
  refuse an internal drag whatever `dataTransfer.types` claims.
- **Image, file and sub-board cards now drag from their BODY as well as
  their header.** This narrows the header-only rule recorded under Phase 2
  rather than overturning it: that rule exists because a text or to-do card
  body holds a caret a drag would fight. These three hold nothing editable,
  so there is no ambiguity — and "grab the picture" is the first thing
  anyone tries. Text, to-do and link cards are unchanged, and a locked card
  drags from nowhere.
- `tests/harness.js` now **records element listeners** and exposes
  `fire(el,type,event)` / `listenerOpts(el,type)`. Before this, a handler
  attached to an element could only be tested by grepping the source, which
  proves nothing about what it does; the wheel tests fire the real handler
  and assert the zoom, the pan, the cursor anchoring, the clamps and
  `preventDefault`.

- **A zoom percentage surfaces over the canvas** while zooming and fades
  (`_boardsShowZoomPill`), the way Milanote's does — the topbar readout is
  unreadable mid-pinch with a hand over the board. It rides
  `_boardsApplyTransform`, which also runs on every pan, so it only appears
  when the zoom actually changed.

### Rich text in note cards (Sept 2026)

Notes can be bold, italic, underlined, struck, bulleted and coloured, from
a formatting bar (`_boardsWireFmtBar`) that appears whenever a note body has
focus — docked above the keyboard on a phone, floating on desktop.

**This walks straight into the stored-XSS boundary every other user string
in `js/boards.js` respects, so the rule is explicit: STORED MARKUP IS NEVER
HANDED TO THE LIVE DOCUMENT.** `_boardsSanitizeRich` parses it with
`DOMParser` into an inert document (no scripts run, no resources load
there), rebuilds it node by node against a fixed allow-list
(`_BOARDS_RICH_TAGS`), and only that rebuilt output is serialised back.
Sanitising happens on **both the write and the read**, so a card written by
an older build, another client, or by hand in the Firestore console is
cleaned before it is ever shown. The only styling that survives is a
literal colour — an allow-list of one is easy to audit.

`c.text` stays the plain-text mirror: search, the PDF index and the PNG
export are unchanged, and a card with no `c.rich` hydrates from it with
`textContent` exactly as before.

Formatting runs through `document.execCommand`. It is deprecated and is
still the only API every browser implements for this; hand-rolling Range
surgery for six commands is far more code and far more ways to corrupt a
selection. What its markup is *allowed* to be is enforced by the sanitiser,
not by trusting the command. **`styleWithCSS` is set per command** — on for
colour (so it comes back as a `<span style="color:…">` the sanitiser keeps),
off for bold (so it comes back as `<b>`). The other way round, bold would
become a style the sanitiser strips.

### Labels, reactions and the phone action bar (Sept 2026)

Both were on the "deliberately missing vs Milanote" list until Afnan's phone
screenshots showed them as first-class actions on a selected card.

- **Labels** (`c.labels = [{t,c}]`) live on the card, and the board's label
  **library is DERIVED** from whatever the cards already carry
  (`_boardsLabelLibrary`) rather than stored anywhere — same discipline as
  frame membership and nesting. A stored library is a second thing to keep
  in step on every rename, delete, undo and paste, with orphan states when
  any of that fails. Label text goes into `_boardsCardText`, so gallery
  search, the Find bar and the PDF index get it free.
- **Reactions** (`c.reactions = {'👍':[uid,…]}`) store **uids, not counts** —
  the same person cannot stack one, and "did I react?" needs no second
  field. The picker is a curated set with keyword search, not a full emoji
  picker: a searchable index of every emoji needs a name dataset this repo
  has no business shipping.
- **One bottom sheet** (`_boardsOpenSheet`, created in `document.body`)
  hosts Labels, Reactions, More, the phone colour picker, the icon picker
  and new-board setup. A menu anchored to a pointer makes no sense on a
  touch screen, so **the long-press context menu docks as a sheet** at phone
  width too.
- **The phone rail is six targets** — Color · Labels · Reactions · Comment ·
  More · Done — and **More renders the SAME item list the right-click menu
  builds**, through the same `_boardsCtxRun` router. That is the rule the
  rail and the old selection bar broke before they were merged.
- Milanote's **"Group into Column"** is the name on the `stack` action.
  **It builds a real container now** — see "Column is a real container";
  this note used to say there was deliberately no stored column.

**Bug found by a harness, not by testing:** both new uses of the signed-in
user wrote `window.session`. **`session` is a top-level `let` in
`js/shared.js` — a lexical global reachable by bare name across these
classic scripts, never a property of `window`.** It would have read empty
in the browser and no reaction would ever have been recorded. Use the bare
name (or `typeof session!=='undefined'&&session`), as the rest of the file
does.

### Board colour and icon (Sept 2026)

A Milanote gallery is read by colour and shape, not by reading titles. Two
optional fields on the board document do it: **`b.color`** (a validated
`#RRGGBB`) and **`b.icon`** (one emoji), rendered as a tile beside the title
(`_boardsTileHTML`) and a coloured top edge on the gallery card. No
migration — a board with neither shows a neutral tile carrying its first
letter.

- **A stored colour is never trusted.** `_boardsValidHex` only lets
  `#RRGGBB` through, so nothing else can reach a `style` attribute;
  `_boardsInkOn` picks black or white by Rec. 601 luma so a custom colour
  can't produce an unreadable tile.
- **The custom picker is hue/saturation/value sliders**, each previewing
  what it would do at the other two's current settings — plain
  `<input type=range>` with CSS gradients, no canvas and no library.
  Deliberately **not** `<input type="color">`, which hands off to a
  different OS dialog on every platform.
- **Creating a board offers name, colour and icon first**
  (`boardsOpenSetup`), then Open. A board created straight into the canvas
  stays "Untitled board" forever — that is how a gallery of them happens.
  It is a sheet, not a required step, and it falls through to the old
  behaviour if the reload that makes the new board addressable fails.

### Right-click menu (Sept 2026)

Built from Milanote screenshots Afnan sent of the real Winter Drop 2027
board. Three rules it holds to:

- **Inside a text card, to-do item or any input, the browser's own menu
  wins.** Spellcheck, copy and paste belong to the browser while you are
  editing text — same reasoning as `_boardsOnKeydown` leaving Ctrl+Z alone
  in a field.
- **New cards land where you right-clicked**, through a one-shot
  `_boardsNextPlacement` that `_boardsPlacementPoint()` consumes. Every
  existing add path (menu, file picker, paste) inherits it without a
  signature change.
- **Right-clicking a card already in a multi-selection keeps the group**;
  right-clicking an unselected one selects just it. Same rule as dragging.

The menu is **per card type** (`_boardsCardCtxItems`): image → Replace /
Download / Open original; file → Replace / Download / Open / Copy link;
link → Open / Copy URL; frame → Rename / **Select contents** (reuses
`_boardsCardsInFrame`); to-do → Tick all / Untick all; text → Copy text;
sub-board → Open / Copy link. Shared blocks carry the real shortcuts
(Ctrl+X/C/D, Del) so the menu teaches them.

- **Cut/Copy fire `document.execCommand`** rather than duplicating logic —
  that raises the real clipboard events `_boardsOnCopy` already handles, so
  the system clipboard stays the single source of truth (Stage 2's rule).
- **Download uses Cloudinary's `fl_attachment`** flag, injected into the
  delivery URL; a non-Cloudinary URL opens as-is. Best-effort, and
  **unverified from the sandbox** ~~which cannot reach res.cloudinary.com~~ *(SUPERSEDED 29 Sept
  2026: it answers from a session; the flag's behaviour on a real asset was not tried)*.
- **Connector lines used to be deleted by a plain left click**, with no
  confirmation and no other interaction. They now carry `data-conn="<i>"`,
  are inert on click, and are deleted from their own right-click menu.
- Cards created from here on carry `by`/`at` (who added it, when), shown at
  the foot of the menu. Older cards don't have it and the line is omitted
  rather than faked; `_boardsCloneCards` resets it, since a duplicate is a
  new card, not a copy of someone else's authorship.

**Still missing vs Milanote** (deliberate, not overlooked): Column and
Table elements, board backgrounds, a standalone heading/banner card,
labels, reactions, and the contextual left rail that changes with the
selected element type. Our equivalent of that rail today is the floating
selection bar; see the note in Stage 2.

### The rail, headings and captions (Sept 2026)

Built from Afnan's Milanote screenshots, where a left rail holds the
add-tools and turns into per-element actions (Color / Labels / Comment /
Preview / Rename / Caption) the moment something is selected.

- **One rail, two modes** (`_boardsRenderRail`) — add-tools when nothing is
  selected, per-type actions when something is. It **replaced both** the
  floating selection bar and the bottom "+ card" strip: two surfaces for
  the same actions had started to duplicate each other.
- **The rail and the right-click menu dispatch through the SAME action
  router** (`_boardsCtxRun`). Adding an action in one place gives it to
  both, and they cannot drift apart — which is exactly how the old
  selection bar and add strip ended up inconsistent.
- The rail's host survives `innerHTML` swaps, so its listeners are wired
  once behind a `__wired` flag. Its `pointerdown` is stopped from reaching
  the stage — otherwise clicking the rail would start a pan and clear the
  very selection you are acting on.
- Icons are **local to `js/boards.js`** (`_BOARDS_ICONS`/`_boardsIcon`),
  not added to `_icon()` in `js/shared.js` — that file is cross-track and
  none of these are wanted elsewhere.
- On a phone the rail docks to the bottom and scrolls sideways.

**Heading cards** (`type:'heading'`) are the section banners Afnan's real
board is organised by — dark full-bleed bar, centred bold text, tintable
with the colour swatches. Its drag strip fades in on hover only, so it
reads as a banner rather than another card. Text is hydrated with
`textContent` like every other user string.

**Card names** (`c.name`) live in the card's header, where the type label
used to be dead text. Click it and type; clearing it `delete`s the field so
the CSS placeholder shows the type again (IMAGE / FILE / NOTE) rather than
leaving a blank strip. The label stops `pointerdown` from reaching the
header, or renaming would start a drag. A named **file** card shows its
name instead of the raw upload filename, and the name is searchable, drawn
into exports, and reachable from the right-click menu, the rail and **F2**.
Frames and headings keep their own in-place titles — `rename` routes by
card type.

**Captions** (`c.caption`) sit under an image or file card, separate from
the file's own name. The field only exists once `caption != null`, so an
untouched card stays clean; the rail's Caption button creates and focuses
it. Captions are included in `_boardsCardText`, so search finds them, and
drawn into the PNG/PDF export.

Also fixed here: `_boardsPaintSelection` only repainted `.board-card-el`,
so marquee-selecting a **frame** left it unhighlighted until the next full
render.

### Right-click on the gallery too (Sept 2026)

The canvas had a context menu but the boards list did not, so the one page
where you actually *manage* boards still gave you Chrome's menu.
**Rename lives here in particular** — before this it was reachable only by
opening a board and clicking its title, which is how a gallery full of
"Untitled board" happens.

- Board card → Open · Rename… · Copy link · Duplicate · Save as template ·
  Make Team/Private · Move to Trash, plus a meta line (visibility · card
  count · owner). Trash row → Restore · Delete forever. Empty space → New
  team board · New private board · Refresh list.
- **Separate router** (`_boardsGalleryCtxRun`) because these act on a board
  BY ID, not on the open canvas — but the same menu renderer
  (`_boardsOpenCtx`), so both menus look and behave identically. The router
  is chosen by the `g:` prefix on the action.
- Permissions follow `_boardsCanEdit` (so anyone can rename a TEAM board,
  per Stage 6) while **Move to Trash stays owner-only**, matching
  `firestore.rules`.
- Rename is **in place** (28 Sept 2026): the tile's title becomes the field
  and the tile's own click is stopped while it is edited. It used to be a
  `prompt()`; see "Milanote: no browser dialogs" below.

### Milanote: no browser dialogs, renames in place (28 Sept 2026)

Change order 1 of the Board session-3 run. **"Creative Hub" is called
Milanote on every screen** — sidebar, phone More sheet, the hub's heading,
"← Back to Milanote", the Home board's back button, the page name the bug
tracker records (`'creative-hub':'Milanote'` in `js/shared.js`), the HRM
dashboard button and the Convert-to-Document text. **Nothing else was
renamed**: files, functions (`_canSeeCreativeHub`, `renderCreativeHub`),
page ids (`creative-hub`) and collections keep their names, and comments
still say Creative Hub where they describe history.

- **No `prompt()`, `confirm()` or `alert()` anywhere in `js/boards.js`
  or `js/notes.js`.** `_boardsConfirm(msg,{ok,no,danger})` and
  `_boardsAsk(msg,value,{field:'text'|'date'})` are the module's own
  dialog (`_boardsDialog`): a Promise, its own ids (`#board-confirm`, not
  `#board-sheet` — a confirm raised from inside a sheet must not close
  it), every string set with `textContent`, Enter = yes, Escape and the
  backdrop = no, and no key reaches the board while it is open. The OK
  button says what it does ("Move to Trash", "Delete forever"). Centred
  on desktop, docked to the bottom on a phone. **Every caller now awaits
  it, so those functions are async** — a test that calls one must await it
  in its own app (the `_pending` hazard in `tests/boards.test.js`).
  `js/notes.js` uses it through a `typeof` guard and deletes nothing
  without it.
- **`_boardsInlineRename(el,{value,commit,cancel})`** is the one in-place
  rename: Enter or leaving the field commits, Escape puts the old text
  back, **an empty field reverts** (never saves a blank), text read and
  written with `textContent` (`.value` for an input), and while it is
  edited a press, click or double-click on it goes no further — these
  titles sit on things that drag or open on a click. Used by the open
  board's title (`boardsTitleFocus` — it no longer saves per keystroke),
  a card's name (F2, through `boardsBeginEdit`; **clearing a name now
  reverts it** rather than removing it — the order said "empty reverts"),
  and "Rename the board…" (`g:rename`: the gallery tile's title, or the
  sub-board card's title on the open canvas, via `_boardsRenameTarget`).
  The label rename, a line's label and a to-do's "Pick a date…" use
  `_boardsAsk` (the date one with a real date field).
- Found by the e2e harness's first stub run and fixed with it: the phone
  board's back button read "← A…" (it is the arrow alone on a phone now,
  its label in `aria-label`), and the rail's "Board name" read "Board n…"
  (it is "Title").
- **Every other native dialog in the app is listed in BOARD-LOG.md as
  P2** (125 lines, file and line), not changed here.

### Making it feel instant (Sept 2026 — measured, not guessed)

Afnan asked for saving to be fully background with no indicator, and for
the app to use the machine it is installed on. A live console probe (run by
Claude in Chrome on a real board) produced the numbers these changes rest
on: **a 1024×1536 image rendering into a 279×458 box — 3.7× per axis, ~13×
the pixels — across 11 Cloudinary requests per load**, and **a steady 60 FPS
while dragging**.

- **Sized derivatives** (`_boardsDisplayUrl`): cards asked for the ORIGINAL
  upload. They now request `f_auto,q_auto,w_{400|800|1200}`, bucketed by
  card width so a handful of URLs are reused and actually hit a cache. The
  **stored** `imageUrl` is never rewritten — the transform is derived at
  render, so existing cards get it with no migration.
- **`crossorigin="anonymous"` on card images.** The probe also reported
  `crossOrigin: null`, which matters more than it looks: the exporter loads
  the same URLs *with* CORS, and a non-CORS cache entry can be handed back
  to that request — the classic "displays fine, taints the canvas" trap.
  Both now share one CORS-enabled entry. If the host turns out not to send
  the header the image would fail outright, so `boardsImgFallback` retries
  once without the attribute: the picture still shows and only the export
  degrades, exactly as it did before.
- **`sw.js` caches `res.cloudinary.com`.** `BYPASS_HOSTS` listed
  `cloudinary.com`, which covered delivery too, so every photo was
  re-fetched on every load. Delivery URLs are immutable, so they are now
  cache-first in a **non-version-scoped** `groovy-ops-images` cache (capped
  at 300 entries) — version-scoping it would re-download every board photo
  on every deploy. `api.cloudinary.com` (uploads) stays bypassed, which is
  what the original rule was really protecting.
- **The save indicator is gone.** No "Unsaved changes…", no "Saving…", no
  "Saved". A progress indicator on an autosave promises the user something
  to wait for, and there isn't one. `_boardsSetSaveStatus` now renders only
  exceptions — `failed`, or `offline` (also driven by the `online`/`offline`
  events, not just by a write).
- **The merge transaction is now presence-aware.** `runTransaction` cannot
  use the local cache: it needs a live round trip and fails offline. That
  is the right price when someone else is on the board and pure cost when
  nobody is — and presence already tells us which. Alone → plain
  `updateDoc`, applied to IndexedDB instantly, synced behind you, works with
  no signal. A peer present → the Stage 6 merge, unchanged.
- **Every write in `js/boards.js` goes through `_qUpdate`/`_qSet`/`_qAdd`/
  `_qDel`**, thin wrappers holding the shared write-buffer's opt-out. This
  **reverses the earlier note** under the Notes module that one-off board
  actions should keep the blocking overlay: Afnan asked for the module to be
  silent, and a presence heartbeat every 25s made the old carve-out untenable
  anyway. The counter is re-entrant, so nesting inside `_boardsSaveNow`'s own
  opt-out is harmless.
- **`navigator.storage.persist()`** is now requested once at load. Nothing
  asked for it before, and Firestore's offline queue lives in the IndexedDB
  the browser was free to evict.

**Deliberately NOT done:** switching drag from `left/top` to `transform`.
It was on the list until the probe measured a steady 60 FPS while dragging.
Worth revisiting only if a 12-card multi-drag on a 46-card board stutters —
measure first.

### Loading must never hang (Sept 2026 — found in QA)

`js/shared.js`'s `renderPage` dispatches these pages as
`loadXData().then(render)` **with no `.catch`** (the `bug-tracker` line is
the one exception). So any rejected query left the page on its loading
skeleton forever, with no error anywhere on screen. Reported from a real
session: the Mood Boards gallery stuck on grey skeleton bars while the
console showed `Missing or insufficient permissions`.

What made it reachable was Stage 6's third query. Firestore **rejects a
query it cannot prove safe against the live rules**, and
`where('sharedWith','array-contains',…)` is unprovable under any ruleset
published before Stage 6 — so with an out-of-date Console the whole
`Promise.all` rejected and took the other two queries down with it.

Both loaders are now written so they **cannot reject**:

- `loadBoardsData()` / `loadNotesData()` settle each query independently
  (`Promise.allSettled`). Whatever succeeded is shown; whatever failed is
  named. All failed → `_boardsLoadError`/`_notesLoadError` renders an
  honest error card with a **Retry** button and says to republish
  `firestore.rules`. Some failed → a warning strip, and the rest of the
  module keeps working.
- The general rule for this codebase: **a loader called from `renderPage`
  must handle its own failure**, because the dispatch line will not.
- **`loadData()` (`js/pos.js`) was converted last, in Sept 2026**, after
  Afnan's dashboard showed "Data load error: Missing or insufficient
  permissions" with every counter at 0. It is the app's oldest and
  most-called loader and it still had the original shape: four of its seven
  queries un-caught inside a `Promise.all`, so ONE refused read threw away
  all seven results. That is why the whole dashboard read zero — POs, gate
  passes, returns and the entire stage overview — when in all likelihood a
  single collection was refused.
  It also made the report unactionable: **"Missing or insufficient
  permissions" is the same string whichever read was denied**, so neither
  the toast nor a screenshot said which one. Every query settles
  independently now, whatever succeeded is applied and rendered, and the
  failing collections are **named** in the toast and logged with their code.
  The three already-`.catch()`-ed queries stay optional and silent. The
  permission retry still forces one token refresh but re-runs **only** the
  queries that failed. `tests/pos.test.js` covers all four behaviours.
  **If a permission error is reported again, the toast now names the
  collection — ask for that text first.**

Same QA round found an unrelated live bug in `js/fabric.js`:
`loadDrawstrings()` set `_dsLoaded=true` only on success, while both
callers (`renderDrawstrings`, `fabTrimAlertsCard`) re-render when the load
settles and the renderer starts another load whenever `!_dsLoaded`. Any
failed read became a **load→render→load loop firing about once a second**
for as long as the page stayed open. Now a failure is recorded in
`_dsLoadErr` (shown once, with Retry) and `_dsLoading` keeps two loads
from overlapping. Note this hit `_gvProgStart/Stop` (the top progress bar),
**not** the blocking "Saving…" overlay — it is not the stuck-overlay
suspect recorded under the Monitor section.

### The Store's REST reads — a failure looked exactly like an empty store (Sept 2026)

Afnan reported the **Stock Log had vanished**: "Log · 0 movements · No
records found." on a collection with thousands of rows, and a missing
category on Inventory in the same session. No error, no toast, nothing to
report — which is the tell.

**`js/store.js` is the ONE module that talks to Firestore over the REST API**
(`_FS_BASE` + a bearer ID token) instead of the window-bridged SDK every
other file uses, so none of the SDK-shaped protections applied to it. Its
read helpers never checked `r.ok`:

- `fsList` returned `(d.documents||[]).map(…)`. A 401/403/429/500 body has
  no `documents` key, so **every failure became `[]`**.
- `fsQueryOrdered`/`fsQueryWhere` returned `Array.isArray(docs)?docs:[]`.
  **`runQuery` answers a failure with a bare `{error:{…}}` object** — and
  can also return `[{error:{…}}]` — so both shapes fell through to `[]`,
  even on HTTP 200.
- `fsDelete` ignored the response entirely, so a **refused delete reported
  success** and the caller dropped the row from the local array anyway.

Every read now goes through `_fsJson`/`_fsThrow`, which throw an error
carrying the collection, the HTTP status and Firestore's own `status` code.
**Reverting the `r.ok` check reproduces the exact reported screen** — a 403
renders `0 movements` and `No records found.` — which is how this was
confirmed rather than guessed; `tests/store.test.js` holds it.

Three more things came out of the same read path:

- **`fsList` ignored `nextPageToken`.** A collection larger than one
  response page was silently truncated, and Firestore may return fewer than
  `pageSize` docs *with* a token. It pages now. This is the most likely
  explanation for a whole category of items being absent from Inventory
  while `allItems.length` still matched the chip counts — an item that never
  arrived is not an orphan, so the "Uncategorised" fallback can't reveal it.
- **`fsQueryOrdered` asked for `limit:3000` in one response.** It is
  cursor-paged now, ordered `<field> DESC, __name__ DESC`. Firestore already
  appends `__name__` implicitly in the same direction, so **this needs no
  composite index** — naming it makes the cursor exact, where a cursor on the
  value alone would skip or repeat rows sharing a `ts`.
- **A failed read could have wiped the stock.** `loadStoreData` seeds
  `INITIAL_ITEMS` when `allItems` comes back empty, and
  `reconstructStockPreview` rebuilds every balance from `_fsListAll`. Both
  were one silent `[]` away from writing 112 zeroed items over the live
  balances on the strength of a 403. The seed is now gated on the read having
  actually *succeeded*, and the rebuild refuses a zero-row read out loud.

**`loadStoreData` was the last `Promise.all` loader in the app** — eight
reads, four of them un-caught, so one refusal threw away all eight and the
whole store read as empty behind a toast that named nothing. Converted to
the `_POS_LOADS` pattern from `js/pos.js`: `_STORE_LOADS` + `_storeRunLoads`
(allSettled), whatever succeeded is applied, permission failures get one
retry behind a forced token refresh, and the toast **names the collections**.

**The rendering rule that follows from this, and it is the real lesson:**
a read that FAILED and a collection that is EMPTY must never produce the same
screen. `_storeLoadErrors` records failures by collection name and
`_storeLoadFailed(col)` exposes them, so the Stock Log renders an error card
with a Retry button instead of "No records found.", and Inventory says
outright when `store_categories` didn't load rather than just omitting its
chips. **Any page reading one of these collections should ask
`_storeLoadFailed()` before rendering an empty state.**

`tests/harness.js` gained a **`fetch` stub** (recording into `state.fetches`,
overridable through `globals`, plus `_res(status,body)`) — `js/store.js`
could not be tested at all before, being the only REST module.

### …and the answer was HTTP 429 — the read quota (Sept 2026)

With the error surfaced, the Stock Log said it outright: **`store_transactions:
read failed (HTTP 429)`**. Not a rules problem, not a bug in the query — the
**Firestore read quota was exhausted**, and `js/store.js` was the thing
exhausting it.

**`loadStoreData` pulled the full 3,000-document movement history on EVERY
store page.** Opening Receive, Issue, Inventory, Templates, the cash ledger or
any PO-issue page cost ~3,000 reads that nothing on screen used. Only three
pages actually read `allTransactions` — the Log, Analytics, and the
Dashboard's last-ten strip. On the free Spark plan's 50,000 reads/day that is
roughly **sixteen page visits before the whole app starts answering 429**, and
because the helpers swallowed the failure, it presented as data vanishing.

- **The history is lazy now.** `_STORE_TXN_LOAD` came out of `_STORE_LOADS`
  into `loadStoreTransactions()`, called from `showPage` for those three
  pages only, once per session (`force` re-reads, for the Retry button).
  **Anything that WRITES against the history must call
  `_storeEnsureTransactions()` first** — `_renameStoreItemCode` migrates every
  matching row and would otherwise report "0 transactions migrated" against an
  array it was never given. It aborts instead.
- **`!allItems.length` was the wrong "already loaded" test.** A refused
  `store_items` read left it empty, so the whole eight-job loader re-ran on
  every store navigation — a feedback loop that burns more of the quota that
  is already gone. `_storeDataLoaded()` tracks the ATTEMPT.
- **429/503/500 are retried, 403 is not.** `_fsFetch` backs off exponentially
  with jitter, honours `Retry-After`, and stops at three tries: a burst limit
  is worth retrying, an exhausted daily quota will not clear in eight seconds
  and hammering it is the wrong thing to do. A refusal will never succeed, so
  it is tried exactly once.
- **The error says what a 429 IS.** `err.quota` is set, and both the toast and
  the Log's error card name the quota and point at Firebase Console → Usage
  instead of sending the next person to `firestore.rules`.

**Blaze, and the two depths (Sept 2026).** Afnan upgraded the project to
Blaze, which removes the 50,000/day cap — the free allowance still applies
daily and only usage past it is billed, so an over-reading page is now a
**bill rather than an outage**. That makes the remaining waste worth fixing
rather than urgent.

The one that mattered: **the Store Dashboard is where every store user
lands, it renders `allTransactions.slice(0,10)`, and it was reading 3,000
documents to show ten.** The history now loads at TWO DEPTHS —
`_STORE_TXN_RECENT` (25) for the Dashboard, `_STORE_TXN_FULL` (3000) for the
Log and Analytics — tracked by `_storeTxnDepth`, which is the READ DEPTH,
not a boolean. A page asking for less than is already held is free; one
asking for more upgrades; it never downgrades.

**`loadStoreTransactions(need, force)` changed signature** — `need` is
`'recent'`/`'full'` and `force` moved to the second argument. The old
`loadStoreTransactions(true)` now silently means "recent, don't force",
which is exactly the sort of quiet breakage this file exists to prevent, so
check every call site if you touch it again.

**Tiering would have silently broken rename, and that is the part worth
remembering.** `_renameStoreItemCode` migrates every row carrying the old
code by scanning `allTransactions`; against the Dashboard's 25 it would have
reported a migrated count that looks perfectly reasonable while missing
almost the entire history. `_storeEnsureTransactions()` therefore demands
**full** depth, never merely "loaded". Asserted both ways. **Any future
read-reduction has to ask what WRITES against the data, not just what
renders it.**

**Known limit, not fixed:** `_STORE_TXN_FULL` is a cap, so a history longer
than 3,000 rows would leave rename missing the oldest ones. The honest fix
is a targeted `where('itemCode','==',code)` query rather than scanning a
capped array — cheaper AND complete — but it is case-SENSITIVE where the
current scan is not, so it needs deciding rather than swapping in.

**If store data goes missing again, read the error card first — it now names
the collection AND the reason.** And before adding any collection to
`_STORE_LOADS`, check which pages actually read it; the default should be
lazy, not eager.

Also fixed in passing: the log's pager border was a hardcoded `#f5f5f5` (a
bright line straight across the card in dark mode) and `setILDir` wrote a
literal `#fff` background under a themed foreground — both leftovers the
property-qualified dark-mode sweep didn't reach.

## Store Accounts (Sept 2026) — REPLACES the Store Cash Ledger

Afnan: *"set up accounts for Groovy in Groovy Ops … the first wave is petty
cash: petty cash is managed by Raees in store."* Then, explaining Raees's
actual job, it turned out to be **purchasing + accounts payable + metered
consumables** with a cash drawer inside it — vendors on credit or cash
terms, monthly bills, Noman the rider buying with floats, every purchase
carrying a **rate**, water and gas **metered daily** and billed monthly,
Excel by date range, a **uniform** log. He declined a question round
(*"think better than I do and start building"*), so every decision is
Claude's and is recorded in **`ACCOUNTS_PLAN.md`** to be overruled there.

**`js/store-cash.js` is DELETED, not patched.** Its study (23 Sept 2026)
found ten defects, the load-bearing ones: four equal wallets and no
petty-cash model; the primary "→ Issue" button posted `kind:'issue'` with
`category:null`, so that spend never appeared in any report; a stored
`balance` on each account doc rewritten on **every page open** from a
5,000-row capped replay (past 5,000 rows every open would write a wrong
number); no void — tapping a row cloned it into a new entry; every entry
stamped UTC-today; categories welded to vendors. The new module is
`js/store-accounts.js`; the old collections are read-only history behind
an owner-only **Import legacy** button (idempotent, `legacyId`).

- **ONE entry shape, `acct_entries`, effects DERIVED.** `_acctEffect(e)` is
  the single definition of what an entry does to Cash, MCB, a vendor's
  payable and a runner's float; the ledger, both books, the vendor
  statement, the KPI tiles and every Excel sheet read it. **No balance is
  stored anywhere.** Types: `purchase | payment | cash_in | transfer |
  float_out | float_in | adjust | opening`.
- **Two money accounts, `cash` and `mcb`** — Afnan: "other bank options
  are irrelevant". The gate-pass fabric sale (`js/gatepass.js`) posts a
  `cash_in` through `window.acctPostSale()` (typeof-guarded); it used to
  post to the old ledger and would have silently no-op'd.
- **Void, never edit.** A voided row stays in the log struck through with
  who/when/why; `firestore.rules` lets an entry's **control fields only**
  change (`hasOnly([...])`) and never deletes one. `tests/store-accounts.test.js`
  asserts every key `_acctPatch` writes is in that list — widen both or
  neither.
- **A purchase line naming a store item IS a Store Receive**: `store_items`
  balance/sizes ↑ and a `store_transactions` `received` row carrying the
  vendor as `supplier` and the `rate`. The money entry is written FIRST;
  a stock failure leaves `stockPosted:false` + `stockError` on it with a
  Retry — never a lost purchase. **Voiding does not reverse stock** (the
  confirm says so).
- **The rate card is derived from purchase lines** (last / min / max /
  count per item per vendor). `window.acctLatestRate(code)` exposes the
  latest for the Store's own use. Nothing is stored on the item.
- **Aging is FIFO** (`_acctVendorAging`): payments settle the oldest
  credit purchases first; unpaid older than `terms.creditDays` is overdue.
  Vendor terms: `cash` · `credit` (days, optional limit) · `monthly` (bill
  day, expected amount) · **`weekly`** (Afnan, 23 Sept 2026: *"make an
  option of weekly billing as well"*, then *"payable days are wednesday
  and saturday"*). A weekly account bills on **several weekdays**
  (`billWeekdays`, 0–6 with Sunday=0, ticked boxes in the wizard, the
  store's payable days ticked by default; `_acctBillDays` also reads a
  legacy single `billWeekday`, and an empty list means the payable
  days); a 7-day aging window; the ledger alert is due on the **most
  recent occurrence of ANY of those days** (`_acctLastWeekday` over each,
  the latest date wins — asserted with a pair whose older day sorts first
  by number) and counts a purchase from that day onward as recorded.
  Consumables carry a `meter` (`count` | `weighed`, unit, rate). The
  vendor **wizard** branches on those answers. The `utility` kind reads
  "Recurring bill" now, not "Monthly bill". **Known limit:** a
  consumable's *Generate bill* is still one bill per vendor-MONTH whatever
  the terms say — weekly terms on a metered vendor set the reminder
  cadence, not the bill's.
- **Payable days** — `acct_settings.payDays`, default **`[3,6]`
  (Wednesday, Saturday)**, seven boxes on the settings card (owners;
  none ticked falls back to the default, never an empty list).
  `_acctPayDays` / `_acctIsPayDay` / `_acctNextPayDay`. On a pay day the
  ledger's alert strip leads with **Pay day (Wednesday) — ₨X owed to N
  vendors · ₨Y overdue** (or "nothing owed", never a zero); the "Owed to
  vendors" tile and a vendor's page name the next pay day otherwise.
  Nothing is scheduled or written on a pay day — it is a reminder of what
  the drawer has to cover.
- **Consumables** (`acct_meter_logs/{vendorId}_{date}`): weighed net = kg
  delivered − kg left in the returned cylinder. **Generate bill** creates
  ONE credit purchase per vendor-month (`meterKey`), then the vendor's
  own figure is recorded beside it and the variance shown.
- **Warn, never block.** `approvalLimit` / `receiptRequiredAbove`
  (`acct_settings/main`) set `needsReview` + `reviewFlags`; owners clear
  from Review. An owner-recorded cash-in is **pending** until Raees
  confirms; pending never counts.
- **Month close** (`acct_closes/{YYYY-MM}`): counted vs book, variance →
  an `adjust` entry dated the last day, checkpoint stores the balance
  AFTER the count plus a payables map. **A closed month refuses new
  entries and voids**; the loader range-queries `month >=` the month
  after the last close and `_acctLive()` skips anything at or before it,
  so a checkpoint is never double-counted (found by the test on the first
  run, both halves).
- **Dates are local and settable** (`_acctToday`, never the UTC ISO
  string); the test scans the source for `toISOString`.
- **Audience:** view owners/managers/`store`; entry owners + `store`
  (Raees); admin owners. Rules: `isStoreAccounts()` = owners + Raees.
- **Excel** (vendored SheetJS): cash statement by date range (Summary ·
  Cash book · MCB book · All entries), vendor workbook (Profile ·
  Statement · Purchase lines · Rate card), payables as of today.
- **Tokens only** — the module has no literal colour (asserted). Two
  `smoke-layout` fragments measure the tiles, alerts, books table, vendor
  page, consumables grid and the purchase form; the tables opt out of
  420px (they scroll inside their wrapper, the Marketing rule).
- **A new category from the purchase form (23 Sept 2026).** Afnan, with
  the Category dropdown open: *"option to create new category"*. The
  select ends in **"+ New category…"** (`window.acctCatChange`): a name
  is asked for, added and selected; an empty answer restores the previous
  pick; a name already on the list in any case selects the existing
  spelling rather than minting a twin. **The list is DERIVED** —
  `_acctCategories()` is settings ∪ every category already on a purchase
  in memory, so a name Raees added, or one the legacy import wrote, is on
  the picker even when the settings write is refused (a cash-in's
  `Fabric sale` is deliberately not a purchase category). **The write is
  an `updateMask` PATCH of exactly `_ACCT_CAT_FIELDS`**
  (`categories, updatedAt, updatedBy`), never `fsSet`'s full-document
  replace: Raees's write can never carry a stale `approvalLimit` over the
  owner's, and `firestore.rules` `acct_settings` holds him to those three
  keys on create (`keys().hasOnly`) and update (`affectedKeys().hasOnly`)
  while owners keep the full write. The test asserts the JS list and both
  rule lists are the same three names — verified by widening the rule
  (fails naming `approvalLimit`), dropping the mask, and dropping the
  entries union. A refused save keeps the name on the form and says so.
- **An EXPENSE is a purchase with no inventory (23 Sept 2026).** Afnan,
  with the Record purchase form open on "PAINT JOB FOR STUDIO" typed into
  Note, the line row empty and Total ₨0: *"the logic is wrong in record a
  purchase if its not a inventory … maintenance work for paint job, how
  will we record them as they have nothing to do with inventory."* He was
  right — the form only spoke stock (item code · qty · unit · rate), so a
  service bill had nowhere to put its amount. The form now asks **What is
  this?** — `Stock purchase` (the lines grid, as before) or `Expense /
  service` (**What was done** + **Amount**, and a line saying nothing goes
  into inventory) — `ACCT_PURCHASE_KINDS`, `window.acctPurchaseKind`. The
  default follows the vendor: a `service` or `utility` vendor opens in
  Expense, `goods`/`consumable` in Stock (`_acctPurchaseKindFor`), and
  changing the vendor flips it. **It is still `type:'purchase'` on the one
  uniform ledger** — stored as ONE description line at qty 1 (`rate` =
  `total` = the amount) with `expense:true`, so `_acctEffect`, FIFO aging,
  the statement, the rate card (which keys on `itemCode`, so an expense
  never enters it) and every Excel sheet needed no second shape; only the
  ledger particulars (`_acctParticulars` → the description alone, never
  "· 1  @ ₨15,000") and the entry detail (Work / service + Amount instead
  of a qty/rate table) read the flag. No `firestore.rules` change — the
  `acct_entries` create rule has no field allow-list. Two smaller fixes in
  the same round: a new stock line is born at **qty 1** (`_acctNewLine`),
  a blank qty beside a rate is read as 1, and a line carrying an amount
  with no description is **refused by name**, never silently dropped;
  and `_acctLineHTML` is a pure function so the layout probe renders the
  REAL row (it used to hand-roll a copy with a shorter placeholder than
  the one shipped — "Item code (or leave blank)" was clipped to "Item
  code (o" in the screenshot; it is "Item code" now, with the hint in the
  title). `.acct-modal` is capped at **860px** on desktop (it was
  `width:100%` with no cap), and between 601 and 820px of viewport the
  line row is **two rows** (what · where, then the numbers — `grid-
  template-areas` by child position) because at ~760px the seven-column
  row left the description ~180px. Measured at 760 in headless Chromium
  (`scratchpad/measure-purchase-760.js`, screenshot looked at): no
  placeholder clipped, the expense block 660px wide. Verified by
  reverting: dropping the flag fails 3 by name, the vendor default 3, the
  amount 5.
- **The daily log prints as a PDF (23 Sept 2026).** Afnan, on the Daily
  Consumable page: *"after a bill is logged in vender page there should be
  a logic to print PDF with log as well (this contans what happened on each
  day + total billing)"*. **Print log (PDF)** sits on the consumables page
  (billed or not, as soon as a day is logged) and on the bill's own entry
  detail, which is what the vendor page opens — the month is read off the
  **last 7 chars** of `meterKey` (`vendorId_YYYY-MM`), never a split on
  `_`, so a vendor id carrying an underscore is safe (asserted with
  `gas_x`). `window.acctConsPdf(vendorId,month)` re-reads the month's
  `acct_meter_logs` and hands a pure builder's output
  (`_acctConsPdfData`) to **`printDocument({type:'consumable-log'})`** —
  the standing rule, no jsPDF here (asserted: the file makes no jsPDF
  call). The page carries one row per calendar day up to today (a day with
  no log prints as dashes, so a gap reads as a gap), a **TOTAL** row with
  the days logged, and a **Billing** section: month total, the bill
  generated (amount, date, on whose account), the vendor's own figure and
  the variance in words, or "No bill generated for this month yet" — a
  **voided** bill is ignored. Weighed vendors get Delivered / Returned /
  Net columns, counted ones a single Received column; the unit sits in the
  subtitle so the heads stay short enough not to clip. The head repeats
  after a page break. Engine side: `_renderConsumableLog` in
  `js/print-engine.js`, `urduLevel` default `minimal`, registered in
  `known`, `_PRINT_DOC_LABELS`, `_VARIANTS`. Verified by reverting: the
  voided-bill check, the head repeat and the entry-detail button each fail
  one assertion by name. **Nobody has opened the PDF** — the engine test
  is a recording fake jsPDF, and the sandbox cannot sign in [29 Sept: a headless QA session can sign in and render — see "Sandbox limits"].
- **Afnan's correction tools (23 Sept 2026): edit, delete, reopen, reset.**
  Afnan: *"put a button in afnan view only to reset + edit + delete record
  of things."* The module's rule stays **void-never-edit, nothing deleted**
  for everyone else; these are NAMED people's repair tools.
  `_ACCT_SUPER_USERS=['afnan','ammar']` / `_acctIsSuper()` — **by USERNAME,
  never the owner role** (a hypothetical third owner gets none of it;
  asserted), the Sept 2026 grant shape — mirrored in `firestore.rules`
  **`isAcctSuper()`** (`afnan@groovy.op`, `ammar@groovy.op`), so a UI leak
  is not a boundary leak. **Ammar was added on 25 Sept 2026** (Afnan: *"give
  ammar the same access as i do"*); until then it was Afnan alone. Every
  route checks the gate first and is a no-op for anyone else (asserted for
  a third owner and for Raees: no write, no modal).
  - **Edit (admin)…** on any entry's detail: `acctAdminEdit` → a form of
    the plain fields (`_ACCT_ADMIN_FIELDS`: date, amount, vendor, person,
    account, to-account, source, category, ref, note). `_acctAdminPatch`
    is PURE and returns only what CHANGED — an untouched form writes
    nothing; `month` follows `date` because the loader range-queries on
    it; a new vendor carries its name; an expense's single line follows
    its amount. The save is one full-document PATCH (**not `_acctPatch`**,
    whose keys are held to the rules' `hasOnly` list by a test) stamped
    `editedAt`/`editedBy`, logged with the field names. Effects are
    DERIVED, so an edited amount re-balances every book with no stored
    balance to fix. **Inventory is never touched** — a purchase that
    posted stock keeps its `store_transactions` rows, and the form says so.
    A future date is refused before any write.
  - **Delete (admin)…**: a real DELETE, gone from memory, confirm says
    "no undo" and, on a stock-posting purchase, that stock is not
    reversed. A 403 keeps the entry and names the refusal.
  - **Reopen <month>** on the review page's **Admin tools** card: deletes
    the close checkpoint and reloads. **Only the LATEST close** — the
    loader reads from the month after the last close, so reopening an
    earlier one would leave a later checkpoint counting a month that had
    come back live.
  - **Reset Store Accounts…**: typed `RESET`, then every document in
    `_ACCT_RESET_COLS` (`acct_entries`, `acct_meter_logs`, `acct_closes`)
    is removed one DELETE at a time with a live count; vendors only when
    ticked (they are the address book). **The pass stops at the first
    refusal** and says how far it got, so a rules problem cannot
    half-empty the ledger silently. Inventory untouched.
  - **Delete vendor…** (same evening — Afnan, with Amin's page open:
    *"option to delete vendor as well"*): on a vendor's page, red, beside
    Deactivate. **REFUSED while any entry names the vendor** — in memory
    AND by a `fsQueryWhere('acct_entries','vendorId',…)` read, because
    the live window starts after the last close and an entry whose vendor
    is gone would still move Cash while dropping out of every statement,
    the payables tile and the rate card. A failed history read refuses
    rather than guesses (the Store lesson). Deactivate is the tool for a
    vendor with history; delete is for one entered by mistake. A
    consumable vendor's `acct_meter_logs` go first and **the vendor
    document goes LAST**, so a refusal part-way leaves the vendor intact
    and the toast says how many logs went. Its `_acctMeterCache` keys are
    dropped, the other vendors' kept. No rules change — `acct_vendors`
    delete was already `isAcctSuper()` and is published. **CONFIRMED
    WORKING ON THE LIVE SITE by Afnan, 23 Sept 2026** (*"vendor deleted,
    works fine"*) — the only piece of the correction tools anyone has
    pressed on a real screen; the rules publish, the gate and the DELETE
    all hold end to end. Do not re-open it on a hunch.
  - Rules: `acct_entries` update is `isAcctSuper() || (isStoreAccounts()
    && hasOnly[...])`, delete `isAcctSuper()`; `acct_closes` and
    `acct_vendors` delete `isAcctSuper()`. The old test "entries can never
    be deleted" was **toothless** — its lazy `[\s\S]*?` ran on to whichever
    later block carried `allow delete: if false` — and is block-scoped now.
  - Verified by reverting: the gate made role-wide (3 fail naming Ammar),
    the vendor delete's in-memory guard (3), its history query (2), the
    vendor deleted before its logs (1), its gate made owner-wide (1),
    the rule's super clause dropped, the month not following the date (3),
    the typed word ignored (deletes on a wrong word). `smoke-layout` gained
    `store accounts — admin tools, edit and reset` (the whole review page,
    never measured before, plus both modals) — fails 6 jobs with the
    card's ink set to `--surface`. **Nobody has pressed any of it on a real
    screen** — the sandbox cannot sign in [29 Sept: a headless QA session can sign in and render — see "Sandbox limits"].
- **A vendor can be paid from OTHER (24 Sept 2026).** Afnan, with the Pay
  a vendor modal open and an empty third slot circled beside Cash / MCB:
  *"OTHER should be here as well but there is no credit debit account of
  other it is settled without a record"* — a director paying from his own
  pocket, a set-off, someone else covering the bill. `ACCT_OTHER`
  (`key:'other'`) is a third **Paid from** chip on the payment form and
  **deliberately NOT in `ACCT_ACCOUNTS`**: it has no balance, no book and no
  tile, and the chip shows *settled outside Cash / MCB* where the other two
  show a balance. `_acctIsMoney(key)` is what the engine asks now — a
  payment with `account:'other'` lowers the vendor's payable (FIFO aging,
  statement, payables tile, Excel all follow, since every one reads
  `_acctEffect`) and moves **neither** Cash nor MCB; the same guard covers
  every type, so a stray `other` on a cash-in mints nothing (it used to be
  `if(acc)fx[acc]-=a`, which would have written a phantom `fx.other`).
  **The note is required for an Other payment** — it is the only record of
  HOW it was settled — and no MCB proof is asked for. The ledger's Source
  column and the entry detail read *Other · settled outside Cash / MCB*;
  the admin edit's Account select offers Other on a **payment only**
  (offering it on a cash-in would create money from nowhere). Only the
  payment form and that select carry it; cash-in, transfer, float and
  adjustment forms are unchanged. No `firestore.rules` change — the
  `acct_entries` create rule has no field allow-list. Verified by
  reverting: the engine guard (fails naming the phantom `other` key), the
  required note (3), the chip (2), the payment-only select (1); the
  purchase-form layout fragment now renders the payment form with Other
  selected and its hint shown, and fails 6 jobs with the hint's ink set to
  `--surface`. **Nobody has paid a vendor from Other on a real screen** —
  the sandbox cannot sign in [29 Sept: a headless QA session can sign in and render — see "Sandbox limits"].
- **Categories and runners, each with a log (24 Sept 2026).** Afnan, with
  the Give-a-float form open: *"when a runner is send for a job it can be
  for many purposes such as mantance work … a catagory of fuel … option to
  create new catagory as well > those catagory will fall in vendor
  mangement"*, then *"there can be more then 1 runner so log created by
  name of other runner as well such as ABBAS"*. Two derived lists, two
  cards on the Vendors tab, two pages — nothing new is stored beyond the
  `category` on a float.
  - **A float carries a `category`, and it is REQUIRED** — the same
    `_acctCatOptions` select the purchase form uses (with `+ New
    category…`), starting on a blank *"what is the runner sent for?"* row;
    a float with none is refused by name. `_acctCategories()` now reads
    `float_out` entries too, so a category a float introduced is on every
    picker. `_acctParticulars` prints it (*Float to Noman · Transport &
    fuel · petrol*). **A bill paid from a float starts in the float's
    category**: `acctPurchaseSourceChanged` moves the purchase form's
    Category to the float's the moment a float is picked as the source
    (still changeable), and the float detail's *Record a bill from it*
    opens the form with **that float and that category preselected**
    (`pre.source` / `pre.category` on `_acctPurchaseForm` — it used to open
    a blank form and leave the float to be found in the chips).
  - **The Vendors tab carries a Categories card** (`_acctCategoriesCard`,
    from `_acctCategoryStats`: entries, spent on purchases, floats given,
    last entry — matched case-folded through `_acctCategoryKey`) and a
    **Runners card** (`_acctRunnersCard` / `_acctRunnerStats`: floats
    given, spent on bills, change back, still to account for). Each row
    opens a page: **`acct-category`** (`_acctCategoryId`, every purchase
    and float under it, totalled) and **`acct-runner`** (`_acctRunnerId`,
    every float given, every bill paid from one and every change back,
    with a *Give a float* button for entry users that opens the form on
    that runner). Both say *since the <month> close* when a close exists —
    they read what is in memory, and the loader starts after the last
    close. `js/shared.js` gained the two page ids in the phone `groups`
    map and `BUG_PAGE_NAMES` (a cross-track file; two additive entries).
  - **The runner list is DERIVED**: the settings' `runners` ∪ every name a
    live float was given to, newest first so the spelling last used is the
    one shown, a voided float naming nobody. **Typing a new name on the
    float form IS how a runner is added** — no settings write, which is
    the point: `firestore.rules` holds Raees's `acct_settings` write to
    `categories, updatedAt, updatedBy`, so a "+ New runner" button would
    have needed a rules change and a republish for something the float
    already records. With more than one runner known the *Given to* field
    starts blank rather than assuming Noman; with exactly one it is still
    prefilled.
  - **A bill is matched to a runner by the FLOAT it was paid from**
    (`e.floatId` against that runner's float ids), never by the `person`
    string on the bill — a bill recorded against Abbas's float is Abbas's
    whatever was typed. Categories match case-folded, so `transport &
    FUEL` typed on a purchase counts under *Transport & fuel*.
  - **+ New category on the Vendors tab** (`acctCategoryNew`, entry users
    only) goes through the same `_acctAddCategory` → field-limited
    settings PATCH as the purchase form's select; a name already on the
    list in any case is not minted twice. No `firestore.rules` change
    anywhere in this round.
  - Verified by reverting: the required category (2), the float's category
    off the list (1), the purchase not moved into the float's category (1),
    case-sensitive matching (5), the button shown to viewers (1), the
    `acctCategoryNew` gate (1), floats not counted on the page (1); the
    runner list from settings only (10), bills matched by name (4), a
    voided float naming a runner (7), *Give a float* shown to viewers (1).
    The wide-only `store accounts — ledger, vendor, consumables` layout
    fragment now renders both cards and both pages. **Nobody has given a
    float with a category, or opened a runner's log, on a real screen** —
    the sandbox cannot sign in [29 Sept: a headless QA session can sign in and render — see "Sandbox limits"].
  - **A probe job flaked during this round, and the cause was the
    fragment, not the form.** `store accounts — tiles, alerts and the
    purchase form @ 420px` failed in light, then in dark, then in both (the
    Paid-via chips "covered by" `.acct-modal-foot`), while the fragment's
    markup dumped from this tree and from the committed one was
    **byte-identical (18,477 bytes)**. `.acct-modal` is a `92dvh` scroll
    box, so whether the first form's bottom row is scrolled out of its body
    — and so under the sticky foot — turns on font metrics at measurement
    time (`font-display:swap`). The fragment's wrapper carries
    `max-height:none` now, so every control is laid out and measured
    rather than scrolled away: the documented false hit, closed at its
    source.
- **Over the float is a credit owed to the runner; and a bill need not
  have a vendor (24 Sept 2026).** Afnan, with three screenshots: *"the cash
  alocated to them if its not the same as give less or more logic should
  be there … credit/ debit logic"*, and categories such as maintenance,
  wages, advances, stationery, fuel, utilities *"should not have a vendor
  based logic entirely … does it have a vendor or not if not proff of
  trasnsstion with is the bill should be mandatory"*. His answers to the
  four questions: *"it is a credit transection untill it is settled by
  anyone"*, Paid to as free text — yes, *"take a photo above 1000 RS other
  then that its optional"*, Advances *"currently plain catagory will be
  connected later on"*.
  - **`_acctRunnerOwed()` is DERIVED like every other balance.** Per float,
    `max(0, used + back − out)` is the runner's over-spend (the bill form
    already confirmed it; the confirm now says the extra is owed to the
    runner); summed per case-folded name, minus every live `runner_pay`
    entry naming that runner. Nothing is stored — a voided bill takes its
    debt with it. An overspent float has `left<0`, so `_acctOpenFloats`
    already closes it to more bills and to change back. `_acctRunnerStats`
    carries `owed`; the Runners card has an *Owed to runner* column, the
    runner page a tile and a **Settle ₨X** button, the ledger's
    *With runners* tile says *owed to runners ₨X*, the alert strip names
    the runner, the float's detail reads *over by ₨X — owed to N*, and the
    statement summary carries an *Owed to runners* row. **Known limit:** a
    month close checkpoints vendor payables only, so an over-spend whose
    settlement lands after a close is read from the live window like a
    float's own leftover is — the same limit floats already have.
  - **`runner_pay` is the settlement** — *Settle with a runner* on the New
    entry menu (refused with a toast when nobody is owed): pick the runner
    (owed ones only, amount prefilled), Paid from **Cash / MCB / Other**
    (Other needs the note, MCB the proof — the payment form's rules), and
    **never more than is owed** (`X is owed only ₨Y`). `_acctEffect`:
    money out when the account is Cash/MCB, `runnerPaid` either way.
    Listed on the runner's page (`_acctRunnerEntries` matches it by
    name), flagged *no receipt* above the review threshold like a payment,
    Other offered on the admin edit's Account select for it.
  - **Does it have a vendor?** is the purchase form's first question
    (`f-hasv` chips). `ACCT_VENDOR_CATS=['Store purchase','Other']`
    (`_acctCatHasVendor`, case-folded) decides the DEFAULT — a vendor
    already picked, or the form opened from a vendor's page, says Yes;
    changing the category re-decides unless a vendor is picked
    (`acctPurchaseCatChanged`). `ACCT_DEFAULTS.categories` is now *Store
    purchase · Maintenance & repairs · Wages · Advances · Office &
    stationery · Fuel & transport · Utilities · Other*; the old names
    (`Transport & fuel`, `Wages & labour`, `Refreshments`) survive on the
    picker through the derived list wherever an entry or the settings doc
    still carries them.
  - **No vendor → `e.payee`** (free text, required; `_acctPayees()` offers
    past ones), `vendorId` null. `_acctVendorName` falls back to it, so
    the ledger's Vendor / person column, the category page and the Excel
    sheets read the payee with no second branch — while payables, aging
    and the rate card key on `vendorId` and never see it. The entry detail
    shows *Paid to … no vendor account* instead of a vendor link.
    **Nothing on credit without a vendor** (the chip is hidden and a
    submit is refused — nobody to owe), and **the bill photo is REQUIRED
    above `ACCT_NOVENDOR_PHOTO_ABOVE` = ₨1,000** — a refusal, not a
    review flag, because the bill is the only proof of a payment nobody
    has a statement for; at or below it the photo is optional, and a
    ₨5,000 VENDOR bill with no photo is still only flagged. `payee` is on
    `_ACCT_ADMIN_FIELDS`. No `firestore.rules` change — the `acct_entries`
    create rule has no field allow-list and `_acctPatch`'s keys did not
    move.
  - Verified by reverting: settlements not deducted (3), over-settling
    allowed (7), the photo rule dropped (5), the payee not read as the
    name (3), `runner_pay` moving no money (1), the category default
    ignored (3); the credit-without-vendor guard **crashes the suite
    rather than naming a finding** when removed (the guard IS the null
    check the credit branch relies on). The form fragment renders the
    no-vendor form and the settle form with Other selected — fails 6 jobs
    at 1:1 with the settle hint's ink set to `--surface`. **CONFIRMED
    WORKING ON THE LIVE SITE by Afnan, 24 Sept 2026** (*"deployed fine,
    runner settle works"*) — the deploy of `7c3f238` (v157) built, and the
    settle path holds end to end on a real screen. Do not re-open
    `runner_pay` or `_acctRunnerOwed` on a hunch. **The vendor-less bill
    and its ₨1,000 photo rule have not been reported on either way** —
    still unseen on a real screen.
- **Raees can EDIT his own entries (26 Sept 2026) — REVERSES "void, never
  edit" for him.** Afnan: *"raees … is insisting that he needs edit rights …
  sometimes they do get wrong so lets make a edit logic"*. Void-and-re-record
  broke everything that points at an entry by id (bills and change-back
  point at a float's id) and filled the ledger with struck-through typos.
  Design in `ACCOUNTS_PLAN.md` §6; the load-bearing parts:
  - **Which entries:** his OWN (`by == session.u`), `posted`, not yet
    reviewed by an owner (`reviewedAt` null), in an OPEN month — the one it
    is in AND the one its new date lands in. Never a void or pending entry,
    an opening balance, a daily-log bill (`meterKey`) or a legacy import;
    the TYPE never changes. `_acctEditBlock(e)` is the ONE decision and
    says why ("Entered by X — ask Afnan or Ammar", "reviewed", "closed");
    the entry detail shows **Edit…** or that line. Afnan/Ammar use the same
    edit on anything in an open month; the raw **Edit (admin)** stays and
    now appends to the same history and refuses a closed month.
  - **The edit IS the recording form, prefilled** (`acctForm(type,{edit})`,
    `_acctPurchaseForm({edit})`), so what a valid entry is has one
    definition. While it is open `_acctEditId` is set and **`_acctLive()`
    leaves that entry out**, so every derived check (balances, open floats,
    runner owed, vendor balance) answers "as if this entry were not there"
    — otherwise a payment that settled a vendor reads the vendor as owing
    nothing. Cleared by any other modal and on close.
  - **Every Raees edit goes to the owners**: a reason is required, the
    entry gets `'edited'` in `reviewFlags` and `needsReview:true`, and
    `e.edits` grows by `{at,by,byName,reason,fields,before,after}` (only
    the changed fields). An "edited" chip on the ledger row, the history on
    the detail, the last reason in the review queue. **Once an owner clears
    it, it is locked to him.**
  - **The write is a MASKED PATCH** (`_acctFsMask`, `updateMask` +
    `currentDocument.exists=true`) of only the changed fields plus the
    edit's bookkeeping — `_acctPatch` uses it too now, so nothing this tab
    did not change is written back and a deleted entry is never recreated.
  - **A field the type's form never shows is KEPT** (`_ACCT_FORM_HAS`):
    editing a gate-pass fabric sale's amount must not blank its `Fabric
    sale` category, nor a transfer lose a ref set by the admin edit.
  - **An edit that would leave money already handed to a runner
    unexplained is REFUSED** (`_acctEditOverpaysRunner`, via a one-entry
    `_acctEditPreview` in `_acctLive`): raising a float, or lowering a bill
    on it, below a `runner_pay` already made. A new entry cannot reach that
    state; only an edit or a void can.
  - **Stock: the store log is the truth.** `_acctStockSync(entry,opts)`
    reads what the entry already posted (`store_transactions where
    acctEntryId == id`) and posts only the DIFFERENCE as a `received` row
    (negative = correction, `correction:true`, shown as "▼ CORRECTION" in
    the Store log) plus the item, in ONE atomic REST `:commit`. It replaced
    `_acctPostStock` for the first post and for **Retry, which had a live
    bug: it re-posted every line each press (32 → 44 → 56).** Hardened by
    the review round: the item is **re-read from the server** before the
    write (allItems is session-stale — a correction hours later would erase
    an issue made on another device); an edit reconciles **only the codes
    whose quantity or sizes changed** (a rate fix must not reconcile a code
    the Store renamed since, which would take the whole purchase back out);
    **one sync per entry at a time** (a double-tapped Retry posted twice);
    a correction bigger than what is left **logs what was really taken
    back** (the Store never holds a negative balance, so the row and the
    balance keep agreeing and a later correction lands on the truth instead
    of minting stock); and a Retry that finds an empty log on a failed
    entry **asks first** (the old poster wrote the balance before the row).
    **A sized line that already went in is LOCKED** in the edit (rows carry
    no per-size history); one whose post FAILED stays editable.
    **Void still does not reverse stock.**
  - **An owner's Clear re-reads the entry first**: accounts data loads once
    per session, so a Clear from a page opened before Raees's edit would
    have cleared an edit nobody looked at (and locked it for good). Changed
    since load → the fresh copy is shown and nothing is cleared. **Known
    limit:** an edit landing in the fraction of a second between the read
    and the write is not caught. An `updateTime` precondition would close
    it, but **the emulator refused one on an UNCHANGED entry** ("base
    version (0)") and that could not be checked against live Firestore — a
    Clear that always fails is worse, so it was left out.
  - **Rules (`firestore.rules`, `acct_entries` update) — CHANGED;
    published 26 Sept 2026.** Four clauses: `isAcctSuper()`; `acctControl()` — status
    and stock fields only, a real transition (no un-voiding), a void bound
    to the caller, refused in a closed month, **the void fields move only
    with the status**, and **an entry an owner reviewed is voided by an
    owner only**; `acctReview()` — owners, review fields only (**the review
    fields left the control list: Raees could have cleared the flag his own
    edit raised**); `acctOwnEdit()` — the edit above, history growing by
    exactly one with the old rows untouched, the new row carrying only the
    app's keys (never `admin`) and naming **exactly** the fields that
    changed. `tests/store-accounts.test.js` holds the lists equal to
    `_ACCT_EDIT_FIELDS`/`_ACCT_EDIT_META` and the history-row keys equal to
    what `_acctSaveEdit` writes.
  - **Known limit, not new:** `acct_entries` CREATE is a bare
    `isStoreAccounts()`, so a modified client can already write any entry
    in any month. `acctOwnEdit` checks the close for the exact months
    involved, so a raw write could move an entry into a month before the
    FIRST close (no close doc exists for it) — no worse than what create
    already allows, and the app refuses it.
  - Verified: 671 assertions; `tests/rules-emulator.js` 77/77 in the real
    emulator with the app's own code writing, and the five new rule cases
    each FAIL against the previous rules; every client guard was reverted
    once and caught by name (the codes filter first survived — a rate-only
    edit never reaches the sync — and got a direct assertion). The runner
    select's case-folded match is not held by a test (the harness has no
    `<select>` options). **Nobody has edited an entry on a real screen** —
    the sandbox cannot sign in [29 Sept: a headless QA session can sign in and render — see "Sandbox limits"].
- **`firestore.rules` changed** (`acct_*` blocks + `isStoreAccounts()`; the
  `store_cash_*` blocks became owner-write) — **published by Afnan, 23 Sept
  2026**; see "Firestore rules" below. **Changed AGAIN the same evening
  (`isAcctSuper()`) — published by Afnan, 23 Sept 2026 (evening)**, see
  below.

**Nobody has recorded a purchase on a real screen** — the sandbox cannot
sign in [29 Sept: a headless QA session can sign in and render — see "Sandbox limits"]. 535 assertions hold the logic; the layout probe holds the shape.

## Store Accounts — level 2: warehouse customer sales (Sept 2026)

Afnan: *"Umair is the warehouse manager and customers that come in and buy
stuff — the ERP we use makes a bill … an accounts section in Umair's tab …
to punch an entry Umair must take a picture or upload the PDF … customer
name + number + order # + due date (pay later, usually people we know) …
discount max 20% … article name searchable with quantity … once it is set
up I will review, then we will add the receivable to Raees's store account
section, as cash is managed by Raees."* The ERP ("Trade Unleashed") bill is
an *Internal Order Tracking* sheet: Bill & Ship To name + phone, Order #
(`SO0334`), Due Date, lines of Name / Barcode (`GP092-M`) / Qty / Price /
Discount / Total, and Notes. **The decisions are tabled in
`ACCOUNTS_PLAN.md` §5 for Afnan's review — overrule them there.**

- **A SECTION, not a page.** Umair's role is scoped in `showPage` to the one
  page `fulfillment`, so Accounts is a third segment of its pill (Daily
  Reporting · PostEx · **Accounts**), plus a sidebar item and a 4th phone
  button (`cols-4`) that call `showFulfillTab('accounts')`. **The
  `showPage` scope line is untouched**, asserted by driving it. The pill
  `flex-wrap`s — three segments overflowed a 390px phone, seen in a real
  render, and the 420px layout probe could not see it. `_fulfillMarkNav()`
  lights the phone button and sidebar item for what is on screen; before
  it, every tab was one page id and only Analytics ever lit.
- **Audience: Umair by USERNAME plus the owners** (`_WHS_USERS`,
  `whsCanView()`), mirrored in `firestore.rules` `isWhSales()` by email.
  Managers see Courier Performance and NOT this section; a manager asking
  for it (`showFulfillTab('accounts')`, a forced `_fulfillSection`) lands on
  Daily Reporting. Raees is not in it yet — the receivable is the next step.
- **One document per ERP order, and its id IS the order number**
  (`whsOrderId`: trimmed, upper-cased, `^[A-Z0-9][A-Z0-9._-]{1,39}$`, the
  same pattern the rule checks on the path). The save is a
  `runTransaction` that reads first and refuses a duplicate BY NAME (who
  recorded it, when); a bill already in memory is refused before any
  network call. The rules are the backstop: a write to an existing id is an
  UPDATE, and updates are held to the void and review fields. **It needs a
  connection** — a transaction cannot use the offline cache — and says so.
- **The bill is required, photo or PDF.** Two pickers: `capture=
  "environment"` for the camera, and a plain one (`image/*,application/pdf`)
  because a `capture` input cannot pick a PDF. It posts to Cloudinary
  `/auto/upload` (the shared `uploadToCloudinary` is `/image/upload`), 15 MB
  cap, and **only an anchored `https://res.cloudinary.com/` URL is kept**
  (`whsBillUrl`), checked on the way back from Cloudinary, in
  `whsBuildSale`, in the rules, and before rendering a stored one.
- **Articles are the daily Shopify copy** (`shopify_products`, the only
  in-app source with a price; the SKU IS the bill's barcode — `GP092` is the
  Pattern Hub's "EFFORTLESS TEE | DEEP BLUE"). Reuses Inventory Intel's
  `_siProducts` when loaded, else one read per session; never rejects; says
  how old the copy is. **Marketing's `mktVariantFromDoc` was NOT reused — it
  drops the price.** `whsSearchCatalog`: an exact barcode first, then a SKU
  prefix, then every word in the name; archived out, drafts after active.
  **Enter picks the top hit and clears the box**, so a USB barcode scanner
  (types the SKU + Enter) adds a line per scan; the same size twice is one
  line with a bigger quantity.
- **A line is a SNAPSHOT** — title, variant, barcode, article code, the
  price charged, the catalog price of the day. The catalog is rewritten
  every day and never deletes a variant, so a pointer would drift.
- **Price: prefilled, editable, and FLAGGED when changed** (`priceEdited`,
  `needsReview`, `reviewFlags`), not refused — the ERP bill is what was
  charged. An article not in the catalog can be typed in (`manual`),
  flagged the same way. "Warn, never block." Owners clear it (**Mark
  reviewed**).
- **The 20% cap is HARD, in the form AND the rules**
  (`discount * 100 <= subtotal * 20`, with `WHS_MAX_DISCOUNT_PCT` asserted
  equal). Whole rupees throughout, so `total == subtotal - discount` is
  exact in the rules. A percentage that rounds a rupee past the cap is held
  AT the cap (20% of 3,493 is 698, not 699); a rupee amount over it is
  refused naming the cap. Asserted across every subtotal 1–5,000.
- **Paid now → Cash or Bank transfer; pay later → a due date** on or after
  the sale date. **Collecting a pay-later bill is not recorded yet** — the
  "to collect" and "Overdue" tiles count every active pay-later sale, and
  the page says collection comes with Raees's accounts.
- **Void, never edit** (Umair or an owner, with a reason, `_WHS_VOID_FIELDS`);
  owners clear the review flag (`_WHS_REVIEW_FIELDS`); both lists are
  asserted equal to the rules' `hasOnly`. Delete is Afnan/Ammar
  (`isAcctSuper`, via `_acctIsSuper` behind a `typeof` guard).
- **A VOIDED BILL CAN BE RECORDED AGAIN — and that is the correction, not a
  loophole** (added after the review round, below). The first cut refused
  any second write to an order number, so a bill entered wrong, once
  voided, could NEVER be recorded correctly: the id was taken forever and
  the only way out was an admin delete. A void's detail now offers
  **Record this bill again**, which opens the form holding everything the
  voided entry held (bill, customer, articles, payment), and the save
  writes over the void carrying it forward in **`priorVoids`** (plain
  values only — Firestore refuses nested arrays), shown on the sale as
  "Recorded before and voided". Typed in from scratch over a void, it asks
  first. **An ACTIVE sale is still one bill, one sale.** The rules allow the
  overwrite only when the stored sale is `void`, through the SAME
  `whSaleValid()` a create uses (so a re-record cannot sneak past the 20%
  cap), and only when `priorVoids` grows by exactly one.
- **Who did it is bound to the signed-in email.** `createdByU`, `voidedBy`
  and `reviewedBy` are usernames and every account is
  `<username>@groovy.op`, so the rules require `+ '@groovy.op' ==
  userEmail()` on each; the ledger reads the NAME from that username
  (`_whsWho`, via `USER_DEFS`), never from the free-text `createdByName`
  beside it. Before this, "Recorded by Afnan" could be written by anyone
  who could write a sale.
- **A failed read is an error card naming `wh_sales` and the republish,
  never an empty ledger** (the Store lesson); the loader never rejects.
- **Rows are flex cards, not a table** — read on a phone at the warehouse.
  Every stored string is escaped (`_whsEsc`, quotes included).
- `tests/warehouse-sales.test.js` (214 assertions) drives the save, the
  void/review/delete, the loader, the upload, the nav and the section, and
  holds the rules to the JS. Verified by breaking each of eleven pieces
  (cap, URL anchor, server duplicate check, audience, price flag, failed
  read, void field list, escaping, rules cap, section gate, phone grid) —
  each fails by name. `smoke-layout` gained **`warehouse sales — the
  Accounts list, the new-sale form and a sale`** at all three widths;
  breaking the amount's ink fails 6 jobs, forcing a row onto one line fails
  at 420. **It does NOT hold the phone layout of a form line** — squeezed
  columns still leave the text technically visible — so that was checked by
  rendering it at 390px in real Chromium and looking. `SMOKE_LAYOUT_ONLY=
  <text>` now measures only matching fragments (CI never sets it).

**THE REVIEW ROUND (25 Sept 2026).** An adversarial review — five lenses,
each finding checked by three skeptics told to refute it — returned 24
findings; the **16 confirmed by at least two** are all fixed, each one
verified by undoing it and watching `tests/warehouse-sales.test.js` fail by
name (15 undo checks; two first crashed the suite instead and were made
null-safe; two first passed because the OTHER guard covered them, and each
got its own assertion). Besides the two above:

- **Searching an order number matched phone numbers.** The digit fallback
  ran on ANY query, so `SO0334` also found every customer whose phone
  starts 0334 — which, for SO03xx, is most Pakistani mobiles; the Excel
  export carried them too. It runs only on a query that IS a phone
  (`_whsPhoneQuery`: digits and separators only), and now understands
  `+92` / `0092`.
- **The name autofill ran on every keystroke**, so a new customer "Ali
  Raza" got a known "Ali"'s phone the moment the field read "Ali". It is
  reversible now: a phone the handler filled is taken back the moment the
  name stops matching, unless Umair has edited it since.
- **Two bill uploads in flight**: the one to finish LAST won and the first
  to finish ended "Uploading…". A pick counter (`billSeq`) means the latest
  pick wins and only it ends the upload; removing a bill mid-upload keeps
  it removed.
- **A price of 0.4 passed "more than 0" and was stored as Rs 0** (and a
  one-line bill then failed on the rules with a message blaming an
  unpublished ruleset). Checked on the rounded rupee; the permission
  message now says the sale may have broken a check.
- **A mobile with a digit missing** (10 digits starting 03) was accepted.
  A mobile is exactly 11; a landline 10 or 11.
- Smaller: the quantity message names the 9,999 cap; a new form clears the
  previous form's search hits and Enter needs text in the box (a scanner
  sends a stray Enter); a read that hits the 1,000-sale cap says so on
  screen instead of silently dropping the oldest pay-later bills.
- **`showFulfillTab` swallowed render errors** — its `.then(f,f)` handled
  the rejection, so a broken render looked like a tap that did nothing and
  `js/diagnostics.js` recorded nothing. It returns the promise again, and
  `renderFulfillmentPage` re-lights its own nav item, which also fixes the
  highlight showing Courier Performance over the Accounts ledger after the
  logo or a Profile round trip.
- **The toast ran off both sides of a phone** (`white-space:nowrap`,
  measured in Chromium at 390px: 1,024px wide from −317 to 707). It wraps
  inside the screen now (358px, 16–374) and stays up in proportion to its
  length — **`css/main.css` `.toast` and `js/shared.js` `showToast`, both
  cross-track, one rule each; it changes every toast in the app, for the
  better.**

**Not fixed — the 8 the skeptics refuted, with the reasons they gave:**
the rules do not tie `subtotal` to the lines (only a writer the rule
already trusts — Umair or an owner, writing to Firestore directly with
their own login — could state a subtotal its lines do not add up to, and
the rules language has no loop to sum them); lowering an article's price
gets past the 20% cap (by design: an edited price is flagged for review,
not refused, because the ERP bill is what was charged); the ERP bill's
per-line Discount column has no field (Afnan asked for ONE bill-level
discount tab); the create rule does not bar the review fields (the review
flag is computed by Umair's own client anyway); an owner who opened
Accounts lands on it again from the Courier Performance card (the section
has always persisted for the session — PostEx does the same); a
malformed hand-written document crashes the detail view (direct writes
only). **My own call, not theirs:** the subtotal one is worth revisiting
when the receivable into Raees's accounts starts reading these totals.

**One refuted finding is a REAL, PRE-EXISTING bug elsewhere, recorded so
it is not lost:** `loadActivity` in `js/activity.js` puts `a.detail`
straight into `innerHTML`, and every `logActivity` caller in the app passes
raw user text (customer names, void reasons, recipe revision reasons …) —
a stored-XSS sink in the owner-only Activity Log. Refuted here only
because this change did not introduce it; Monitor escapes the same field.
The fix belongs in `js/activity.js`, not in each caller.

**Nobody has recorded a sale on a real screen** — the sandbox cannot sign
in [29 Sept: a headless QA session can sign in and render — see "Sandbox limits"].

### The warehouse money reaches Raees (26 Sept 2026)

Afnan: a paid order's money should land in Raees's accounts *"with the
correct medium, such as cash or bank transfer in MCB … Raees will confirm
that he has received the payment"*. His answers: Umair gets **Mark
collected** on a pay-later bill and it flows the same way; **Raees, Afnan
and Ammar** can confirm; **bank transfers wait for confirmation too** and
land in MCB. Decisions tabled in `ACCOUNTS_PLAN.md` §5a.

- **NOTHING IS COPIED — the queue is DERIVED.** `whsHandovers(sales,
  confirmations)` (`js/warehouse-sales.js`) is the one decision: every sale
  that puts money in hand (`whsMoneyIn`: paid now, or a pay-later bill with
  `collectedVia`/`collectedDate`) minus those with a live confirmation =
  **pending**; a live confirmation whose sale no longer puts money in hand
  (voided, un-collected) = **orphan**. Umair's list, Raees's queue, the alert
  strip and the review card all read it. **A confirmation is MATCHED BY ORDER
  NUMBER** (`whsConfOrder`), not by version — see the review round below.
- **A confirmation is an ordinary `cash_in`** in `acct_entries`
  (`_acctWhEntry`, `js/store-accounts.js`): `src:'wh'`, `whSale` =
  `whsHandKey(sale)` = `<order>#<priorVoids.length>` (kept as HISTORY: a
  bill recorded again after a void is the SAME order, covered by the money
  already received — ~~a new version needing its own confirmation~~ was the
  review round's first money bug),
  account `cash` or `mcb` (`WHS_ACCT_OF`), **dated the day Raees confirms**,
  category *Warehouse sale*, the customer as person, the order as ref, the
  bill as the photo. `_acctEffect` needed no change. **Until confirmed it is
  not in the books.**
- **One confirmation per version, without a transaction.** The id is
  `whs_<ORDER>_<v>` (`_acctWhId`), written by a REST PATCH with
  `currentDocument.exists=false` (`_acctWhCreate`) — a second device's
  confirm is refused by Firestore and says someone got there first. If a
  VOIDED confirmation holds the id, the next free suffix (`_2`, …) is used.
  A transaction would need a connection; this needs one too, but is a single
  write.
- **Different amount…** records what was really received with a required
  reason, flagged for owner review (`short handover` / `more than the
  bill`). The books follow the cash, not the bill.
- **An orphan's money STAYS in the books** — the cash really was handed
  over. The owners are told (urgent alert + the queue's orphan list) and
  voiding the cash in is their deliberate act. Voiding the SALE warns Umair
  first when Raees already received it.
- **Confirmations are read ALL-TIME** (`whsLoadConfirmations`: `where('src',
  '==','wh')` through the SDK, never rejects) — Store Accounts itself loads
  only months after the last close, and a sale confirmed in a closed month
  would otherwise come back as waiting. A failed read is an error card
  naming `acct_entries`, never an empty queue. A confirm into a CLOSED month
  is refused (it is dated today, so only after a close of the current
  month).
- **Umair's side:** `window.whsCollect` → cash or bank + the day (not before
  the sale, not in the future; `whsCollectPatch` is pure and is exactly what
  the rules check). A collected bill leaves *to collect* and *Overdue*; new
  filters *Collected* and *Not with Raees yet*; each sale says **With Raees
  ✓** or **Not with Raees yet**; *Undo collection* only while Raees has not
  received it; the Excel export gained three columns.
- **Load order:** `store-accounts.js` loads BEFORE `warehouse-sales.js`, so
  every call across is at RUNTIME behind `typeof` (`_acctWhOn()`); a build
  without warehouse sales shows nothing.
- **Rules (`firestore.rules`, `wh_sales`) — CHANGED; published 26 Sept 2026:**
  read widened to `isStoreAccounts()`; one new update clause lets
  `isWhSales()` set (or clear, for undo) EXACTLY the five collection fields
  (`_WHS_COLLECT_FIELDS`, asserted equal) on an active pay-later sale, bound
  to the caller's email, `collectedDate >= date`. ~~The confirmation needs
  no rule change~~ — it does since the review round (`whConfValid`, below).
  Emulator: 91/91 at the time, 103/103 after the review round, with the
  app's own code writing; the new permissions fail against the previous
  rules.
- Tests: `tests/warehouse-sales.test.js` (money in hand, the derived queue,
  collect/undo driven through the modal, Raees confirming through the REST
  create, a second device refused, a different amount, confirm-all for a
  day, a voided id's suffix, a closed month, who may do what); every piece
  reverted once and caught by name. `smoke-layout` gained **`store accounts
  — from the warehouse (both ends)`** at all three widths — breaking the
  amount ink fails naming all three queue rows.

**THE REVIEW ROUND (26 Sept 2026, later).** An adversarial review (money,
rules, concurrency, UX lenses; each finding given to three skeptics told to
refute it) confirmed 8 findings. Half its verifiers died on the session
limit, so the unverified concurrency and UX findings were checked by hand
against the code: 7 were real. All are fixed, and **every fix was reverted
once and caught by a test by name** (19 mutations; the one not caught is the
second layer of escaping behind a date that is already sanitised, so it
cannot be reached while the first layer holds):

- **A bill voided and recorded again asked Raees to receive the same money
  again** (the one-click default put it in the books TWICE, and a first
  confirmation in a closed month could never be voided). Matched by order
  now: the money received covers the corrected entry. When the corrected
  bill no longer matches what was received (another total, cash vs bank) it
  is **CHANGED** (`whsConfChanged`: `whSaleTotal`/`account` against the
  sale) — a warn alert and a list for the owners, never re-queued. Umair's
  side reads "With Raees · bill changed since".
- **Month close ignored unconfirmed warehouse cash**, so the drawer count
  (an adjustment dated in the month) and the later confirmation (a cash in
  dated that day) both added it. `_acctWhCloseBlock` re-reads both lists and
  refuses the close while a payment dated on or before the month's last day
  is waiting — or when the warehouse data cannot be read. Like a pending
  cash in, it blocks.
- **Voiding / editing / deleting a warehouse cash in** left the warehouse's
  own copy of the confirmations stale — the sale stayed "with Raees" with
  its money in no book. `_acctWhTouched` updates that copy at once and
  re-reads it.
- **Raees confirmed against a list read once per session.** Every
  confirmation now RE-READS THE SALE over REST first (`_acctWhSaleNow`) and
  refuses one voided, un-collected or recorded again since
  (`_acctWhStillSame`); a failed re-read of the confirmations refuses too
  (it used to fall through to the old copy). Both lists also refresh when
  looked at again after a minute (`whsRefreshIfStale`) and when the queue
  is opened.
- **Stored XSS through the sale date.** The rules never checked `date`, and
  the queue drew it raw into HTML and an `onclick`. `whSaleValid` requires
  a YYYY-MM-DD day now; `whsMoneyIn` only ever returns a day; every date in
  the queue and the entry detail is escaped; Confirm-all needs a real day.
- **A collection could be rewritten in place after Raees confirmed it**
  (cash → bank by a direct write). The rule sets a collection only on an
  UNcollected bill and clears it only on a collected one.
- **A confirmation was whatever the client wrote.** `whConfValid` (rules,
  `acct_entries` create when `src=='wh'`): the sale exists and still puts
  money in hand, `whSaleTotal` is the sale's total, and an amount that is
  not the bill must carry `needsReview` — so it cannot quietly clear the
  queue for less. An ordinary cash in is untouched.
- **Managers** view Store Accounts but may not read `wh_sales`, so they
  carried a permanent urgent "could not be read — republish" alert. The
  queue is for the people who receive the money (`_acctCanEntry`).
- **Past the 1,000-sale read cap**, an old confirmation with no sale in the
  read was reported as an urgent orphan. It is `outside` now, and the queue
  says the read is capped.
- **Undo collection** read Raees's side BEFORE asking, trusted an offline
  cached read (`snap.metadata.fromCache`), and vanished when the read had
  failed. It asks first, refuses a cached answer, and is offered while the
  state is unknown (it re-checks).
- **Mark collected offline** held `_whsBusy` until the write reached the
  server, silently blocking every new sale. Its own flag now, and it says
  it needs a connection.
- The REST create and the sale re-read give up after 20s (`_acctWhFetch`),
  so a hung request cannot leave every Received button dead.

**Not fixed, on purpose:** a short handover still reads "With Raees ✓ …
₨X short" — the rest of the money has no path through the queue; the
entry is flagged for the owners, who settle it. Emulator: **103/103**; the
8 new rule cases each FAIL against the previous rules.

**Nobody has confirmed a warehouse payment or marked a bill collected on a
real screen** — the sandbox cannot sign in [29 Sept: a headless QA session can sign in and render — see "Sandbox limits"].

## Master Accounts — M1 built (28 Sept 2026) · on `main` and served (29 Sept), rules reported published, deploy list unseen, not yet seen

Afnan, 27 Sept 2026: *"I want accounts but just for me and ammar, in short
master accounts … plan all the logics of build first so we have a good
foundation."* The plan is **`MASTER_ACCOUNTS_PLAN.md`** (v4, with an M1
status section, §21a) — read it before touching anything named `ma-`, `ma_`
or `MA_`. The planning record (v1–v4, the specimen, the two design reports)
is condensed at the end of this section.

**M2 (couriers and collections, 30 Sept 2026) is built on top of this and has
its own section below, "Master Accounts — M2 built".** This section is M1 as it
stood on 29 Sept 2026, status statements included: the heading's "rules reported
published" is M1's rules file, not M2's (M2's is a different, newer file, sent
and, on 30 Sept, reported published — not checkable; the M2 section has it); and
where it counts what M2 changed — 15 `ma_*` collections, eight `ma-*` page ids,
nine live Record kinds, "Coming later · 8" — the M2 section has the new numbers
(19, nine, eleven, 7).

**Where it stands — verified from git, 29 Sept.** Nine M1 commits on
`claude/master-accounts-planning-udoiw9`, now on `main`:
`bf09235` M1.1 the core · `1d8b3c5` M1.2 the rules · `06b9256` M1.3 the
pages · `7b4aa30` M1.4 the PDFs · `6f2e152` M1.5a the server functions ·
`4057303` M1.5b the client for them · `704056b` M1.6a edits and
confirmations held at the rules · `20260a0` M1.6b the screens, the idle
re-lock and the device cache · `7735410` M1.6c the server tightening
(attachments fail closed — decision 5; cherry-picked from the server
round's `5291a14`, which was built on `704056b`). After M1.6b, `main` was
merged INTO the branch eleven times — `1dc7fa9` (`origin/main` at
`1f6327d`, `CACHE_VERSION` v247), `feca515` (`4c8bfee`, v249), `be22046`
(`3333584`, v251), `d159f83` (`dc0e609`, v252), `1ae7e71` (`e1f84bf`,
v254), `5a36efe` (`bac4848`, v255), `672cf4f` (`d1af808`, v256), `69f5c72`
(`5996999`, v257), `ef7eabb` (`08b530a`, v258), `51cf6c3` (`1b56a46`, v259)
and `a436e8b` (`11bd681`, docs only, v259 unchanged) — **the last `main`
commit the branch has taken is `11bd681`**; between the second
and third, `efb75ce` named the nightly backup in the audit trail (v250),
and after M1.6c, `8e5fe0b` is its client half (v253): Settings says when
attachments are off. **Then the verification round's two fixes (29 Sept),
built side by side on `bef4dc4` and combined here:** `0a0df4b` (security —
V1, V2, V3, V5, V7, V8, V9, V11; its own title calls it "M1.6c
(security)", which is not the server round above) and `44166f3` (money and
screens — V4, V6, V10 and the visual QA's F01–F24; cherry-picked from
`8f1a1df`, author's message and trailers kept). What each changed, and how
it was checked, is under "The review round" below. **Then Afnan's three
calls on the QA's judgement findings (29 Sept):** `22cfd3e` (F26 and F27)
and `c836de2` (F25). **Then main's QA work came in, in three merges:** the
eighth, `69f5c72` (`5996999`: the Color Library's TCX codes tab, v257); the
ninth, `ef7eabb` (`08b530a`: main's QA-account work — `isQaRead()` on every
read rule and a uid pin in `isQa()` — v258); the tenth, `51cf6c3`
(`1b56a46`: the Color Library's Pantone C tab and Milanote opening on Mood
Boards, v259). **`8573391` keeps Master Accounts owner-only against that QA
work** (see "The gate"). The eleventh merge, `a436e8b`, took `11bd681`,
main's docs-only record of the QA-read publish. **Then the branch went INTO
`main`, on 29 Sept 2026, with Afnan's go-ahead** (relayed by the
coordinator: "Yes, merge into main"): `main` was fast-forwarded to `a436e8b`
first and then to `914b67a` — the docs commit that carried the first version
of this line (verified: `git ls-remote origin refs/heads/main` read `914b67a…`
at 16:17 UTC as relayed, and again at 16:24 UTC) — so `main` has no merge
commit of its own for it. The docs commit that carries this text sits on top
of `914b67a` and goes to `main` the same way. **Verified this run (29 Sept 2026, after a `git
fetch`):** every commit hash this section names that is a commit in this checkout — 46 of
them, the M1 commits `bf09235`…`44166f3`, the eleven merges, `22cfd3e`, `c836de2`, `8573391`,
`a436e8b`, `914b67a` — is an ancestor of `origin/main` (`git merge-base --is-ancestor`, none
false); `5291a14` and `8f1a1df` (the sources of two cherry-picks) are not in this checkout, and
the `md5`s named are file hashes, not commits. The Master Accounts files exist on `origin/main`
(`git ls-tree`: `js/ma-core.js`, `js/master-accounts.js`, `netlify/lib/ma-server.js`,
`netlify/functions/ma-attach.js`, `ma-share.js` and `ma-backup.js`, the `ma-*` and
`master-accounts-*` tests, `MASTER_ACCOUNTS_PLAN.md`). `git ls-remote origin refs/heads/main`
read `fa44f86…`, a docs-only commit two ahead of `a436e8b`; before this branch merged it,
`origin/main..HEAD` was 1 (the 29 Sept docs commit `f4298a0`) and `HEAD..origin/main` was 2.

- **On `main` since 29 Sept 2026, and SERVED — verified 29 Sept 2026 (16:39 UTC); the Netlify
  deploy list is still unseen.** ~~Netlify builds `main`, and nothing in a session can see its
  deploy list (`*.netlify.app` is blocked here, and this repo carries no Netlify commit
  statuses)~~ **SUPERSEDED: `groovyoperations.netlify.app` answers from a session.** Read this
  run by unauthenticated GET and compared by `md5sum` with `git show origin/main:<file>`:
  `sw.js` (`CACHE_VERSION = 'v259'`), `index.html` (it carries the `/js/ma-core.js?v=20260929v257`
  and `/js/master-accounts.js` script tags), `js/master-accounts.js` and `js/ma-core.js` — **all
  four byte-identical to `origin/main`'s**, and the served `sw.js` precaches both scripts. The
  last commit to touch any of the four is `51cf6c3`, so a build containing Master Accounts, at
  `51cf6c3` or later, is live: for these four files what Netlify serves is the current `main`'s,
  not an older build (a browser's own service-worker cache is a separate matter). **What this
  does not show:** the Netlify deploy LIST — whether `a436e8b`, `914b67a` and `fa44f86`
  (docs-only for those files) were built, skipped or failed, and which commit built the served
  bytes — or that the three `ma-*` Netlify functions are deployed and configured (none was
  called). `main` was `914b67a` when first checked (`git ls-remote`, 16:24 UTC) and `fa44f86` in
  this run, and GitHub Actions `tests` on `main` completed with success for both `a436e8b` (run
  36595973484) and `914b67a` (run 36596441345) — read from the workflow-runs API at about 16:25
  UTC; that is CI, not Netlify. `CACHE_VERSION` is v259, past the branch's last version before
  the QA merges (v257, `69f5c72`) and `main`'s (v256, `1b56a46`).
- **The rules: a third publish was REPORTED on 29 Sept 2026 (about 16:18
  UTC), and what the Console holds is still NOT known.** Afnan wrote "rules
  updated record", taken to mean he published the rules; **reported, not
  checkable from a session, and his message did not name the file.** The
  file he had been sent ten minutes before (as relayed) is the FINAL one, on
  `main` now: LF md5 `9d7ec162b9812b5358d2ce07a400824a`, 1,526 lines —
  main's file plus the 384-line Master Accounts block, none removed
  (verified: `git diff --numstat 11bd681 914b67a -- firestore.rules` reads
  `384 0`). **Hypothesis, unverified: that is what he pasted** — if so, the
  `ma_*` rules and main's QA-read rules are both live. Two publishes were
  reported earlier that day, and **neither was that file**: **Afnan's**
  ("rules published"), the merged file at `dcfef5c` — LF md5
  `acc9a3a1cec525ee4e1d335da30124fe`, 1,502 lines: main's rules plus the
  Master Accounts block with M1.6a and V3, and none of main's QA-read rules;
  **Ammar's**, recorded on `main` (`11bd681`, that evening): main's own file
  at `08b530a` — LF md5 `7d858a05ce8ecf6aae585bbd79892960`, 1,142 lines, with
  the QA-read rules and **no `ma_*` block** (verified: 0 `match /ma_` in
  it). If the Console still held Ammar's, **every Master Accounts read and
  write is denied — to Afnan and Ammar too**: it fails closed, each page
  shows *"Could not read … — republish firestore.rules with the Master
  Accounts block"*, and nothing is lost, because nothing could be written.
  **Which file is live, only the Console's rules history knows.** The test
  from Afnan's side is a Master Accounts page that loads; it needs a build
  containing Master Accounts to be served, which ~~is the unconfirmed Netlify
  deploy above~~ it is (verified above; the deploy list itself is still unseen). See "Firestore rules — published" before anything else.
  **Live QA probe of the 15 `ma_*` collections (this run, 29 Sept 2026, after the 16:39 UTC
  reads):** signed in as the QA account (Identity Toolkit HTTP 200; the password came from the
  environment and was never printed) and made ONE Firestore REST list (`?pageSize=1`) per
  collection — `ma_accounts`, `ma_sv_accounts`, `ma_parties`, `ma_items`, `ma_settings`,
  `ma_commitments`, `ma_counters`, `ma_feedback`, `ma_journal`, `ma_transfer`, `ma_counts`,
  `ma_closes`, `ma_audit`, `ma_backups`, `ma_shares` — **all 15 answered HTTP 403** (status
  only; bodies discarded, no document content read). The repo's read rule on each is
  `isMasterAccounts()` alone and `signedIn()` excludes QA (read from `firestore.rules`), so a
  refusal is what those rules give. **403 is AMBIGUOUS:** the same answer comes from a published
  file WITH the Master Accounts block and from one with NO `ma_*` block (default deny — e.g.
  Ammar's reported `7d858a05…`), so it does NOT show the block is live. What it does show: none of
  the 15 admitted the QA account, so the live rules do not expose the owner's books to it (a 200
  would have been a leak). Which file the Console holds is still unknown.
- **Master Accounts stays owner-only, even from the automated QA account
  (`8573391`, 29 Sept 2026).** Main's QA work made every read rule admit
  the QA account `claude@groovy.op` (`isQaRead()`); the 15 `ma_*`
  collections are the one named exemption — Afnan's words for the module
  were "just for me and Ammar" — so their read rules stay
  `isMasterAccounts()` alone. Held by `tests/qa-read-guard.test.js` (the
  exemption, and a section that fails if it ever becomes an opening),
  `tests/rules-emulator-qa.js` part 1b (QA REFUSED `get` and `list` on
  every `ma_*` path, with afnan and ammar as the control) and
  `tools/qa-snapshot-lib.js` (`ma_*` stays out of the default emulator
  snapshot). See "The gate".
- **The verification round's two blockers (V1, V2) are fixed** (`0a0df4b`),
  which is what let the branch go into `main`. What stays open is listed at
  the end of "The review round".
- **Afnan's answers to the three QA judgement calls (29 Sept 2026) — all
  three BUILT** (`22cfd3e` F26 and F27, `c836de2` F25). **F26** — the
  Record picker's nine live kinds are unchanged, and the eight that arrive
  in later milestones fold behind one "Coming later · 8" line, folded again
  every time the picker opens. **F27** — the rail slides over the page up
  to 1440px wide (it was 1200px), so below 1441px an open rail no longer
  narrows the page. **F27's cost:** below 1441px an open rail covers the
  page header's Record and ⋯ buttons (at 1024px also the period buttons
  Year and All); the rail's × closes it. **F25 — a correction to this
  record:** it said "keep the 'No opening balance yet' alert, no change",
  but **there was no such alert** — the QA had only suggested one. Afnan
  chose to have it ("yes build the opening balance alert", 29 Sept 2026),
  and it is built: while the book has no opening balance, Needs attention
  LEADS with a concern (red), "No opening balance yet — the books start
  when one is recorded.", whose **Record it** opens the Opening balance
  form directly (`window.maConcern` → `window.maRecordKind('opening')`).
  The rule is `maIsOpening(d)` in `js/ma-core.js`, the one definition —
  `maValidate`'s second-opening check reads it too: the book has an
  opening when any journal of kind opening is not void (journals are never
  pending; an opening dated before go-live still counts). It is weighted
  `Number.MAX_SAFE_INTEGER`, so it leads; `maNeedsAttention` shows it only
  when it is handed the document list, and a refused `ma_journal` read
  shows the error card, never the line (read from the code; the page
  behaviour is driven in `tests/ma-fix-money.test.js`). On an empty book
  the Dashboard card reads "2 need attention" (its author's Chromium run —
  reported).
- **Nobody has opened a page, a PDF or a share link on a real screen.**
  ~~The sandbox cannot sign in;~~ *(SUPERSEDED 29 Sept 2026: a headless QA session can sign in,
  but this module is owner-only — the QA account is refused on all 15 `ma_*` collections
  (probed, above) and is not on `_MA_USERS`, which is `['afnan','ammar']` in
  `js/master-accounts.js` — so no QA session can open these pages against live data).* Every
  visual claim below is headless Chromium.

### The files

- **`js/ma-core.js`** (2,304 lines at `1ae7e71`) — **PURE**: no DOM, no
  Firestore, no session, no clock unless a caller passes `today`; a guarded
  `module.exports` at the foot, which is how the functions and the node
  tests `require` it. Every decision the books make lives here once: both
  charts of accounts (`MA_CHART` for Groovy, `MA_SV_CHART` for the Savings
  book — seeded, its pages are M4), the settings and their defaults
  (`MA_DEFAULT_SETTINGS`, `maSettings`), July fiscal periods, whole-rupee
  money grouped in lakh/crore and spelled out (`maRsWords`), the tax block,
  the three document types (`MA_DOC_TYPES`: journal `JV`, transfer `TR`,
  count `CT`) and the six journal kinds, **`maBuildDoc` → `maValidate`
  (refuse / flag; 58 distinct rule names, 56 before M1.6b, counting
  the unknown-document guard) → `maPost`** (lines
  carrying the plan's §27 labels), balances, holders, the trial balance,
  the ledger with a running balance, edits / voids / confirmations, parties
  with terms and rate cards kept with history, items, the cost register,
  the rule-based 30-day calendar and "needs attention" lines, the
  Unlabelled and review queues, FIFO allocation (unused until M3),
  attachments as references, WhatsApp and share helpers, the PDF data
  builders (`maPdf*Data`) and Download the books. Since `44166f3` it also
  holds the ONE cash rule every total reads (`maHolderCash`, V4), the check
  that an edit raised a new flag (`maNewFlagRules`, V6), a period in words
  (`maPeriodLabel`) and a rate grouped the lakh way (`maRsRate`).
- **`js/master-accounts.js`** (3,113 lines at `1ae7e71`) — the pages. It
  reads Firestore, paints, and writes exactly what the core built: the
  writer, the loader, the re-lock, files, links, the owners' copy and the
  device cache at sign-out (which since `0a0df4b` reads Firestore's own
  queue before it deletes anything, and tells this person's other tabs —
  decision 12).
- **`netlify/lib/ma-server.js`** — code the three functions share, kept
  OUTSIDE `netlify/functions` so it is bundled rather than deployed as an
  endpoint (the postex-core precedent): the owner check (a verified ID
  token, `checkRevoked` on, so a revoked session or a disabled account is
  refused at once; the email compared EXACTLY, as the rules compare it, so
  `Ammar@groovy.op` is refused — M1.6c), `startAdmin(tag)` (a function that
  cannot start answers a generic 503 before it knows the caller, "The server
  is not set up yet — the reason is in the Netlify function log.", and logs
  the reason as `[ma-attach]` / `[ma-share] refused before the caller was
  known: …` — M1.6c), `cloudinaryConfig` (decision 5), Cloudinary's
  signature hand-rolled on node `crypto` (checked against golden values from
  the Cloudinary Node SDK 2.11.0 — **never against the live API**),
  server-minted file names `ma/<64 hex>`, and audit rows in the core's own
  shape.
- **`netlify/functions/ma-attach.js`** — POST, owners only. `status` (which
  of three states is in force — decision 5; `not_configured` answers 503
  with the whole status in the body), `sign` (the exact fields for a
  browser-to-Cloudinary upload as `type:'authenticated'`, under a name
  minted here, with `overwrite:0` inside the signature; the file never
  passes through Netlify and the secret never leaves it), `url` (a signed
  download link that dies in 5 minutes — asking again is how you look
  again). 25 MB cap and an image/PDF allow-list are checked here.
- **`netlify/functions/ma-share.js`** — `GET ?t=<token>` is **the one public
  door into the books** and opens exactly one PDF: a 32-byte token, 404 for
  an unknown or malformed one, 410 for a withdrawn or expired one, else a
  302 to a Cloudinary link that dies in 5 minutes (to the file's permanent
  public address in the fallback — decision 5), with `no-store`,
  `no-referrer`, `noindex` and a `default-src 'none'` CSP on the plain
  pages. POST `create` / `revoke` for the owners, each in the same batch as
  its audit row; since M1.6c `create` keeps the document's revision the PDF
  was made at (`subject.rev` → `docRev`: a whole number ≥ 1, absent when not
  sent, `400 subject` for anything else), returned at the top of the answer
  and inside `share`, and the share panel says when a live link is of an
  older revision. Link-preview fetches (WhatsApp building the preview, among
  a named list of bots) are counted in `previews`, not `opens`, so "opened
  once" means a person. A link lives `share.defaultDays` (7), capped at 90.
- **`netlify/functions/ma-backup.js`** — scheduled `30 * * * *`
  (`netlify.toml`). Each wake resolves any export still running (done, or
  failed with Google's own words) and, at the first wake at or after
  **03:30 UTC (08:30 PKT)**, starts ONE Firestore managed export of every
  `ma_*` collection plus the feeders (`postex_orders`, `wh_sales`,
  `acct_*`, `payroll_runs`, `payslips`, `shopify_orders`) to
  `gs://$MA_BACKUP_BUCKET/ma-backups/<UTC stamp>`, under a day id claimed
  in a transaction so two wakes never start two exports. **Why hourly, when
  the plan said daily:** an export takes minutes and a scheduled function
  gets seconds, and the Today page reads only the LATEST row — resolved
  once a day, last night's failure would be buried by tonight's fresh row
  the moment it was found. "Not set up" is written as a failed,
  `not_configured` row, never as a backup that worked. Its audit rows carry
  `by:'ma-backup'`, which the trail shows as "Nightly backup" (`efb75ce`).
  It cannot be opened by URL (Netlify answers 403 to a scheduled function);
  the first run after 03:30 UTC is the test, and it writes its own result.
- **Tests:** `tests/master-accounts-core.test.js`, `master-accounts.test.js`,
  `master-accounts-pdf.test.js`, `master-accounts-files.test.js`,
  `master-accounts-screens.test.js` (M1.6b), `ma-server.test.js`,
  `ma-attach.test.js`, `ma-share.test.js`, `ma-backup.test.js`,
  `ma-fix-sec.test.js` (130, `0a0df4b` — it drives the real `js/auth.js`
  and `js/master-accounts.js` against stubbed bridges and a fake IndexedDB)
  and `ma-fix-money.test.js` (128 at `44166f3`; 155 at `22cfd3e`, 180 at
  `c836de2`), with
  `tests/ma-fake-admin.js` (an in-memory Admin SDK).
  **`tests/rules-emulator-ma.js`** is NOT a `*.test.js` — it needs
  firebase-tools, the emulator and Java; its header has the commands, and
  it builds every document with the app's own `js/ma-core.js`. Fourteen
  `master accounts — …` `smoke-layout` fragments; the six nav pages in
  `smoke-app-phone.js`.

### The pages, and the one Record button

Eight page ids through ONE `renderPage` line (`id.startsWith('ma-')` →
`maRenderPage`): **Today** `ma-overview` (cash in hand as the hero, in and
out this month, owed to us less we owe, Needs attention, cash by holder,
the next 30 days and a day-by-day strip) · **Money** `ma-money` (holders,
pending transfers, counts; a holder's statement is `ma-holder`) · **Money
out** `ma-out` (in M1 the cost register only — commitments with their
state, and *Record payment* prefilling a Money out) · **Parties**
`ma-parties` (a party is `ma-party`: terms and rate card with history,
documents, ledger) · **Ledger** `ma-ledger` (postings, documents, the
Unlabelled and review queues, and a document rail with its edit history,
edit / void / confirm / review, files, PDF and share) · **Close & audit**
`ma-close` (the quarters and their state — no screen closes a quarter yet,
see decision 7 — backups, Download the books, the audit trail, settings,
the chart, items). The plan's other four (Money in, Costing, Savings,
Reports) arrive with later milestones.

**Record** in every page header opens one picker: nine live kinds (Money
out · Money in · Transfer · Count · Owner put money in · Owner took money
out · Opening balance · Journal · Commitment) and eight named with the
milestone they arrive in (Collection M2; Bill, Payment, Purchase order,
Receipt M3; Payout, Loan, Savings entry M4). Nav: a collapsible **"Master
Accounts ▸"** sidebar section (not "Accounts", which the Store section
already carries), **"Master Accounts ›"** in the owner's phone More sheet,
and an owner dashboard card (cash in hand · how many need attention).

### The collections — all owner-only, read AND write

Masters: `ma_accounts`, `ma_sv_accounts`, `ma_parties`, `ma_items`,
`ma_settings`, `ma_commitments`, `ma_counters`, `ma_feedback`. Documents:
`ma_journal`, `ma_transfer`, `ma_counts` — **the id IS the number**
(`JV-27-0001`: kind, fiscal year, sequence). Then `ma_closes`, `ma_audit`
(append-only), and `ma_backups` / `ma_shares` (written by the functions
only). An `ma_*` collection not named in the rules is default-deny, even to
an owner.

**There is no `ma_postings`.** The plan's §7 and §16.2 name one; M1 stores
none. Postings are computed in the browser from the documents on every
render (`maPostAll`), balances are never stored (the plan's §2), and the
emulator checks by name that an owner is refused `ma_postings`. M1's volume
is small enough to read every document whole; `js/master-accounts.js`'s
header records the plan once a quarter is locked (read from the last close
onward, page the rest).

**The one balance read from elsewhere is the store drawer (1010):** Store
Accounts' `_acctBalances().cash`, through `loadAccountsData()`. Since M1.6b
it is read fresh with a 12-second bound, says "as of", and is read again
after five minutes. A failed read is never a zero — cash in hand says
"drawer not read — incomplete". Nothing in Master Accounts may spend from
the drawer (`holder.mirror`); a handover to or from it is a transfer, and
waits (below).

**Every cash total reads ONE rule, `maHolderCash` (V4, `44166f3`).** A
handover waiting to go INTO the drawer is taken out of the drawer's figure,
because Store Accounts' balance moves when Raees records the handover —
before an owner confirms it here. Before the fix only the 30-day panel took
it out, so the Today hero counted it twice. The hero, both holders tables'
totals, the Dashboard card and the 30-day start all go through it now, and
each says what it leaves out: under the hero, on a "Less: handed into the
drawer, not confirmed yet" line above a holders table's total, and on the
Dashboard card. **The trade-off, stated rather than hidden:** until Raees
records the handover in Store Accounts, every total is short by it, and says
so beside the figure. Neither way can a total read more than is there.
Whether Raees in practice records a handover before an owner confirms it is
not verifiable from a session.

### The gate — four lists, one test

`_MA_USERS` (client, by username) · `MA_OWNERS` (the core) ·
`isMasterAccounts()` (rules, by email) · `MA_OWNER_EMAILS` (the functions).
`tests/ma-server.test.js` holds all four equal — widening one alone fails
there. Afnan and Ammar only, and by name, never by role: no third owner and
no Mustafa. Raees and Umair appear only as the people whose hands a holder
is in — they confirm on paper, through an owner — until M8 carries their own
entry surfaces over.

**This is the app's first owner-only READ.** Every other collection is
readable by some wider group. The committed emulator test refuses a read of
every `ma_*` collection to Mustafa (a manager), Raees and a signed-out
caller (re-run against the merged rules at `1ae7e71`: 241 / 241); the
security review extended that to Umair, Daniyal, Sami, Arfat, an email-less
token and an upper-case email (reported, from its own scratch probe). The
`js/shared.js` entry points are `typeof`-guarded and fail CLOSED. Main's QA
identity (`claude@groovy.op`, merged in with `1ae7e71`) is on none of the
four lists, and `isMasterAccounts()` is built on `signedIn()`, which main's
rules now make exclude it (read from the rules file).

**Master Accounts is owner-only from the QA account too, and that is a
NAMED exemption, not an omission (`8573391`, 29 Sept 2026).** Main's QA work
made every other read rule admit the QA account through `isQaRead()` (91
read rules, ~~93~~ 94 lines in the file — corrected 29 Sept 2026). The 15 `ma_*`
collections are the one family that does not — Afnan's words for the module were "just for me and
Ammar", and the account used for automated QA must not read the owner's
books — so their read rules stay `isMasterAccounts()` alone. Verified at the
tip: no `isQaRead()` and no `isQa()` inside any `ma_` block. Three things
hold it, so it cannot turn into an opening (each read from the files):
`tests/qa-read-guard.test.js` exempts the `ma_*` blocks from three checks
that hold every other collection, and has a section of its own — every
`ma_` read rule is exactly `isMasterAccounts()`, no `ma_` block mentions
`isQa` or `isQaRead`, `isMasterAccounts()` is built on `signedIn()` and
names no QA account, the exempt family is the literal `ma_` prefix, and all
15 known collections are found; `tests/rules-emulator-qa.js` part 1b proves
QA is REFUSED `get` and `list` on every `ma_` path, with afnan and ammar
succeeding on the same documents as the control (604 / 604 in that suite,
reported by the merge agent); `tools/qa-snapshot-lib.js` (`OWNER_ONLY_BOOKS`,
`isOwnerOnlyBooks()`) keeps `ma_*` out of the default emulator snapshot —
an explicit `--collections ma_…` is still honoured, a deliberate ask by
someone holding live credentials (the merge agent's call, flagged for
Afnan). **Not held by any committed check:** nothing in the repo checks LIVE
that QA is refused — `tools/qa-probe.js` has no `ma_` line (`grep -c ma_
tools/qa-probe.js` reads 0, re-read 30 Sept 2026) — ~~and `QA_ACCESS.md` still
says QA reads owner-only collections (its lines 12–13) and "reads everything"
(line 78), with no `ma_` exception; that file is `main`'s and was not edited
here.~~ *(SUPERSEDED 29 Sept 2026, PR #100 `e1a767b`: `QA_ACCESS.md` now names the
`ma_*` exception — verified 30 Sept: `grep -n ma_ QA_ACCESS.md` hits its lines 23,
29, 53, 97 and 166.)* **Held live only by a one-off:** a REST list of all 15
`ma_*` collections as the QA account on 29 Sept 2026 answered HTTP 403 for each —
ambiguous between "block not published" and "block published, QA refused" (see
"On `main` since" above). It predates M2's four collections (19 now; their read
rules are `isMasterAccounts()` alone too — verified), which no live probe has
touched; in the emulator QA is REFUSED on all 19 (`tests/rules-emulator-qa.js`,
re-run 30 Sept: 632 passed).

### The decisions that hold it up — with the reasons

1. **One transaction per new document:** read `ma_counters/{type}`, mint
   the number for the document's fiscal year, write the counter, the
   document and an `ma_audit` row. A refused write spends no number (the
   Pattern Hub lesson). A transaction needs a connection — offline, the
   page says so and writes nothing.
2. **A document changes in exactly four shapes, and the rules hold each:**
   EDIT (rev + 1; `edits[]` grows by ONE row by the caller that names
   exactly the fields that changed), VOID (a transition with a reason,
   never a rewrite), CONFIRM (a pending transfer), REVIEW (the two review
   fields, in the reviewer's own name). **No client delete on any `ma_*`
   collection, ever.** Since M1.6a an edit also: never moves the status, a
   confirmation, a review or a void; **names `amount` and `tax`** (they are
   what posts — before M1.6a the rules let an edit move them unnamed);
   keeps `month`, `quarter` and `fy` bound to its date; stores its own live
   flags, and **clears the review when a figure moved** (an owner reviewed
   the old figures, not the new ones). A count keeps the book it was held
   against unless its day or count moves, and which holder was counted
   cannot change. The JS lists (`MA_EDIT_FIELDS`, `MA_EDIT_DERIVED`,
   `MA_FIGURE_FIELDS`) and the rules' lists are held equal by a test.
   **Since `0a0df4b` (V3) the rules also check SHAPES** on every
   `ma_journal` / `ma_transfer` / `ma_counts` create and edit (`maShapeOk`):
   a holder code is a STRING of four digits, the first not 0 (`maCodeOk` —
   the number `1010` and `"1010 "` are no code); an amount is whole rupees
   above zero (a count: counted and book whole and ≥ 0); the journal kinds
   that move money through one holder (money out, money in, capital,
   drawing — held equal to the core's list by a test) name that holder as a
   code; an edit's new row names only fields an edit may change and is
   stamped within five minutes of the server's clock; and `historical` may
   move only to what the date and `goLive` say (`maGoLive()`:
   `ma_settings/main`'s `goLive`, else `2026-10-01`, held equal to
   `MA_DEFAULT_SETTINGS.goLive`). Codes must be strings, so a stored
   document with a numeric code would be refused on its next edit; the app's
   builder writes strings, and until the merge into `main` (29 Sept) no
   build of the branch was deployed, so none is expected (not checked
   against live data). **Since `44166f3` (V6)** an
   edit that raises a flag the document did not carry clears the review too
   (`maNewFlagRules`, compared by rule, so a re-worded message is not new) —
   taking the note off a Money out booked to an income account moves no
   figure but makes a claim no owner has seen. The rules already allowed
   that write (checked against the combined rules in the emulator, 5 / 5).
   **Still not held at the rules, and owner-forgery only:** an edit that
   names a real field can store whatever `flags` it likes (C1, partly
   closed — the rules cannot re-derive `maLiveFlags`), and an edit row's
   `before` / `after` values are not bound to the document (C2, partly
   closed — its date and its field list are).
3. **Who confirms a transfer is ONE map, never the form's choice.**
   `MA_HANDS` / `MA_DRAWERS` (`js/ma-core.js`, read off the seeded chart)
   and `maHands()` / `maDrawers()` (rules) — a test holds them equal. The
   person whose hands the money reaches confirms: an owner in the app,
   anyone else "on paper" (an owner holding the signed receipt, recorded as
   `confirmVia:'paper'`). Pending counts in neither holder. Driven through
   `maTransferConfirm` at `704056b`:

   | Route | Waits for | How |
   |---|---|---|
   | MCB → the owner who records it · an owner's cash → MCB | nobody | posts at once |
   | MCB → the other owner · one owner's cash → the other's | that owner | in the app |
   | anything → the drawer (1010) | Raees | on paper |
   | the drawer → MCB (a holder nobody holds) | Raees | on paper |
   | the drawer → Afnan or Ammar | that owner — **even when they recorded it themselves** | in the app, after *"Has Raees recorded it?"* |
   | anything → the warehouse till (1040) | Umair | on paper — and refused today: 1040 is switched off until M5 (`holder.inactive`) |

   **This REVERSES M1.3's "a transfer into the mirrored drawer posts at
   once."** The drawer's balance is read from Raees's Store Accounts, so a
   handover posted here before he books it there is counted twice or not at
   all (money review F9) — the drawer is therefore his hands in BOTH
   directions, and confirming asks first whether he has recorded it. A
   transfer that waits for, or was confirmed by, someone keeps its from,
   to, amount and date: void it and record it again (money F6 — before
   M1.6a a note-only edit of a confirmed transfer sent it back to pending
   and moved two balances behind a row that said "note"). A create may carry
   no `confirmed*`, `reviewed*` or `voided*` key, and its status,
   `confirmBy` and `confirmPaper` must be the map's answer (security F2).
   The F2 residual the verification round found — a hand-written transfer
   with a non-string code or a negative amount skipping the derived
   confirmation — is closed at the rules by V3 (`0a0df4b`, decision 2).
   **F9 on the screens is closed by V4** (`44166f3`): the Today hero, the
   holders tables, the Dashboard card and the 30-day panel all take a
   waiting drawer handover out through `maHolderCash` ("The one balance read
   from elsewhere" above). It still rests on Raees booking a handover in
   Store Accounts before an owner confirms it here — unverified.
4. **Journals cannot do what the other kinds refuse — in the client only.**
   A general journal that moves money between two holders is refused
   (record a transfer: it waits for the receiver); one that pays out of a
   holder with no file or no named payee is flagged; a second opening for
   an account is flagged (money F12). **The rules language cannot loop over
   a list**, so none of this is held at the rules — the one known gap the
   rules comment names.
5. **A file is a REFERENCE, never a URL.** `{publicId, format, type, …}`,
   picked field by field (`maAttachClean`): a private link is dead in five
   minutes anyway, and in the public fallback the URL is the file's only
   lock, which a stored copy would carry into every export and backup —
   Cloudinary's answer holds both `secure_url` and `url`, so a spread of it
   would have stored them.
   Adding a file later is an edit with history; the "no bill" flag is
   answered by derivation (`maLiveFlags`), not by rewriting stored flags.
   **Attachments FAIL CLOSED (M1.6c, `7735410`; security F7).**
   `cloudinaryConfig` answers one of three states: `signed` (both keys set
   — private files, links that expire), `public` (no usable key AND
   `MA_ALLOW_PUBLIC_ATTACH` exactly "1", spaces trimmed — the app's unsigned
   `groovy-ops` preset under the same random name: the file is PUBLIC, its
   address opens it for good, and files uploaded in that mode STAY public
   after the keys are set), or `not_configured` (neither — nothing is
   uploaded and no link is made). A key holding whitespace is not a key.
   Before M1.6c the public fallback was what a missing key silently meant;
   now it is only ever chosen. When not configured, `sign` and share
   creation answer `503 not_configured` with one plain sentence — what is
   missing (never its value) and both ways out — and `status` answers 503
   with the state; `url` and the share GET are unchanged, so a file that is
   already public keeps opening. Signed uploads carry `overwrite:0` inside
   the signature: that is how Cloudinary's Node SDK 2.11.0 sends
   `overwrite:false`, and the signature is pinned to the SDK's own output.
   Settings (Close & audit) asks the server and says which state is in
   force — "Attachments are off — not set up." with the server's sentence
   (`8e5fe0b`, keyed on the body's `state`, never on `code`: the generic
   503 a function sends before it knows the caller carries
   `not_configured` too), private, or public because the opt-in is 1.
   **Unverifiable from a session, and the first real upload is the test:**
   whether the live Cloudinary account accepts `overwrite=0` on
   authenticated uploads, what it does with a replayed upload, and the
   plan's size limits.
6. **The audit trail is written NOW and shows who from `by`.** Since M1.6a
   the rules refuse an `ma_audit` row whose `at` is more than five minutes
   from the server's clock, and the trail and its Excel print the name
   derived from `by` (the field the rules bind to the signed-in person),
   never the stored `byName` — and "Nightly backup" for the backup
   function's own rows (`efb75ce`; no client can write that `by`).
   **The client writes every document, edit, void, confirm, review and
   master change in ONE transaction or batch with its audit row, so once
   these rules are published a device whose clock is more than five minutes
   off has every Master Accounts write refused** — the error says to check
   the clock. The rules do not themselves require an audit row beside a
   document write (only the quarter re-lock checks for one); the pairing is
   the client's. The "opened" and "unlocked" rows are written quietly and
   fail silently. Since `0a0df4b` (V3) an edit's own row in `edits[]` is
   held to the same five minutes, which adds no new clock failure: every
   edit already goes out beside an audit row (both page call sites stamp
   `Date.now()`, and a test fails if a new call site does not).
7. **Quarters:** a close is born LOCKED and a reopened quarter goes back
   through an audited re-lock (`maCloseRelock`, the rules' `maRelockOk` —
   the audit row must be created in the same batch), security F3b. **No
   M1 screen writes `ma_closes`** — "the quarter lock arrives with M11",
   and a test asserts the page never writes one — so the lock rules and
   the "quarter closed" refusals on confirm and review are ready but
   unreachable from the app today.
8. **Loaders never reject.** `maLoad` settles all eleven reads on their
   own; a refused one is an error card naming the collection ("… republish
   firestore.rules with the Master Accounts block"), never an empty list or
   a zero — the Store lesson.
9. **The PDFs compute nothing.** Five `js/print-engine.js` variants, every
   figure from `maPdf*Data`: `ma-ledger` (one account, A4 LANDSCAPE, its
   head redrawn on every page), `ma-statement-party`, `ma-statement-holder`
   (A4), `ma-receipt` (a transfer's handover slip — the plan's collection
   receipt needs M2's collections) and `ma-voucher` (a Money-out voucher —
   bills and allocation are M3), both A5 with VOID and "Revised · rev N"
   stamps, N being `maRevOf` — ONE revision number for the rail and the
   paper, which M1.5b found disagreeing by one. Since M1.6b the ledger
   draws no opening, closing or Balance column under a narrowing filter or
   for the mirrored drawer (`balanceHidden`), and says why. **The slips are
   `full` but print English:** the embedded Urdu font cannot draw what
   jsPDF emits (see "Print design system"), and `_prMaUrduOk` asks the font
   before drawing a word of Urdu. A slip in waiting never prints a
   confirmation.
10. **Download the books** (Close & audit): a JSON of every `ma_*`
    collection — the copy a restore would read, shaped for the plan's
    `ma-import`, which is NOT built — and one Excel workbook (the
    postings, the trial balance, every collection as a sheet). A
    collection that could not be read is named in both files, the share
    tokens are withheld (M1.6b), and the download writes an `export` audit
    row.
11. **The idle re-lock (§29)** asks again after `relockMinutes` (15): the
    fingerprint where this device has the app lock (`_lockShow`), else the
    password (`reauthenticateWithCredential`). The clock is a per-uid
    `localStorage` timestamp (`groovy-ma-active`) — a curtain, not a
    boundary; a sign-in inside the window counts as activity. **Since M1.6b
    the lock is asked everywhere, not only on navigation** (security F5: a
    page left open showed the books until someone touched it, and that one
    touch reset the clock): a tap or a key on an `ma-*` page while the lock
    is due SHOWS the lock and never touches the clock; every repaint asks
    first; coming back to the tab and a 30-second check swap an open page
    for the lock; an open form or share panel closes with it; the idle lock
    writes no audit row (unlocking writes a quiet "entered" row), so the
    word "relock" stays the quarter's. **F5 is closed since `0a0df4b`
    (V5):** every relock check — the tab coming back, the 30-second timer,
    a tap anywhere — also swaps the Dashboard card's figures for "Master
    Accounts is locked — open it to unlock." (`_maCardRelock`), so a card
    painted before the lock came due no longer keeps them. (Read from the
    code, not reproduced: `_maPopulateDashboard` checks the lock once,
    before its reads, so a lock that falls due while they run is painted
    over until the next check — at most 30 seconds.) **And the fingerprint
    opens the books only on a real check (V9):** `_lockDone(verified)`
    (`js/auth.js`) passes true only when the authenticator's UV bit was set;
    "nothing to guard" — no lock record, no WebAuthn, an old cached
    `index.html` — passes false, which the app lock's own callback ignores
    (it must never strand anyone) and Master Accounts' unlock treats as "ask
    for the password".
12. **An owner's sign-out takes the books off the device (M1.6b, security
    F6; rewritten by `0a0df4b`).** `doLogout` and `lockUsePassword`
    (`js/auth.js`) first call `window.maBooksOffDevice()` behind `typeof`;
    `index.html` bridges `terminate`, `clearIndexedDbPersistence` and
    `waitForPendingWrites` for it. For an owner, in this order (read from
    `_maBooksOffDevice` at `1ae7e71`): wait for pending writes (≤ 5 s) →
    tell this person's other Groovy Ops tabs to go to the login
    (BroadcastChannel `groovy-ma-signout`, with a localStorage key for a
    browser without it — V8) → terminate Firestore (≤ 5 s; a terminate
    that never settles is `stay` — V11) → read Firestore's OWN mutation
    queue (≤ 5 s, `_maQueuedAny`, the SDK 10.12.2 IndexedDB layout:
    `mutations` and `mutationQueues`) → delete the copy (≤ 5 s). **The copy
    is KEPT, and the owner told why, whenever anything is waiting** — this
    person's writes (`queued`) or ANYONE ELSE's on this device (`others`,
    V2: one database holds every account's unsent writes, and deleting it
    had deleted theirs) — **or when the queue cannot be read** (`unchecked`,
    fail safe). A delete refused because another tab holds the copy, or one
    that does not finish, is `stay`: Sign out then reloads still signed in
    (and cold, so the lock is asked again, if the lock came up meanwhile),
    while **the lock's "Use password instead" ALWAYS signs out** (V1): the
    lock stays on screen and nothing unlocks it (`_lockLeaving`) until it
    has, `u` leaves sessionStorage first, and it says the copy stayed. **One
    way out per tab** (V7): a second Sign out, or one of each, gets the
    first one's promise (`_authLeave`); one that failed is forgotten and its
    error re-thrown, and `maBooksOffDevice` itself runs once per tab. A tab
    whose Firestore was terminated under it goes to the login too (V8). A
    cached `index.html` without the bridges signs out exactly as before.
    **Checked by its author with the real SDK 10.12.2 in Chromium against
    the emulator (reported, not re-run here):** Mustafa's queued write was
    lost to Afnan's sign-out before the fix (the admin read answered 404)
    and reaches the server after (200). **What it cannot promise:** a
    changed SDK layout reads as `unchecked` and KEEPS the copy (safe, but it
    then never clears until this code learns the layout); a kept copy stays
    on a shared device until the other person has signed in online and the
    owner signs in and out again — the message says exactly that.
13. **Classic-script hygiene:** every global is `ma`/`_ma`/`MA_`-prefixed
    (one lexical scope with every other file), no `window.X=` names a
    top-level function (the Board calendar freeze), and the CSS is one
    block where every selector carries `.ma-` — `.ma-*`, `table.ma-*`,
    `textarea.ma-in`, `a.ma-btn` — the `today` / `cal-today` class
    collision below is why. Checked at `1ae7e71` and again at `672cf4f`:
    all 275 selector parts in the block carry `.ma-` (282 since F26's
    `.ma-fold` and `.ma-soon` rules; re-counted at `a436e8b` with a script
    written for it, still every one). **Three of them reach outside the shell, from
    `44166f3` (F01/F02, a sticky header and rail):**
    `#main-content:has(>.ma-shell)` (≥601px: `overflow-x:clip;
    overflow-y:visible` — `#main-content` was a scroll container that never
    scrolls, so nothing inside it could stick) and `#scr-app
    #main-content:has(>.ma-shell) .ma-head` / `… .ma-rail` (the 52px under
    the top bar; the rail's only above 1440px since F27, 1200px before).
    **Why they are safe:** each
    matches only while an `.ma-shell` is `#main-content`'s direct child —
    i.e. only on a Master Accounts page — and the two whose subject is not
    `#main-content` are `.ma-` elements; the offsets carry the same
    `:has(>.ma-shell)` as the rule they depend on, so a browser without
    `:has()` drops all three together and the header stays in the flow as
    it was before (the fixer measured that in Chromium by deleting the
    `:has()` rules — reported; with the offset left alone it had pushed the
    header 70px down over the tabs). `#scr-app` scopes the 52px to the real
    shell, because the layout probe's fragments have no top bar.
    **Unverified on real devices:** `:has()` (Chrome 105, Safari 15.4,
    Firefox 121) and `overflow:clip` (Chrome 90, Safari 16) — Safari
    15.4–15.6 has the first and not the second, which drops the `clip` and
    leaves both axes `visible`; not seen, not measured.

### The review round (28 Sept, against `4057303`), and the verification after it

Two adversarial reviews, each finding reproduced by a script or a probe.
Their reports (`review-money/findings.md`, `review-sec/findings.md`), and
the verification round's, lived in the session scratchpad and are
deliberately not committed: this repo is public and they carry step-by-step
reproductions — this summary is the record.

- **Money and data integrity:** thirteen F-numbered findings — nine
  labelled major (F9 "design — numbers reproduced, process not
  verifiable"), four minor — plus minors M1–M4, nits N1–N3 and two
  suspected, not reproduced. **The posting engine held:** 20,000 fuzzed
  documents through `maBuildDoc → maValidate → maPost` all balanced, and a
  trial balance over 46,407 lines was zero (reported, not re-run).
- **Security and privacy:** the boundary against non-owners held. Four
  major — an edit could move money without naming it (F1), a transfer's
  confirmation was enforced only by the form (F2), the idle re-lock never
  fires on an open page (F5), and **the books stay in the browser's
  IndexedDB after sign-out** (F6: reproduced with a newer SDK than the
  app's pinned 10.12.2 — a non-owner on the same browser profile read an
  owner's journal from the offline cache while the server refused him) —
  plus minors F3, F3b, F4, F7 and nits.
- **M1.6a (`704056b`) closed the rules-side items:** security F1, F2, F3,
  F3b, F4; money F2, F6 and its receipt addendum, F7, F8, F9, F11, F12,
  M4 — each as recorded in decisions 2–7.
- **M1.6b (`20260a0`) closed the screens' items — per the verification
  round, which re-checked every finding against `20260a0`:** money F1, F3,
  F4, F5, F10, F13, M1, M2, N1–N3 FIXED; security F6 FIXED "with two new
  problems" (V1, V2). **Still partly open** by the same round: money F9
  (V4) and M3 (voiding withdraws live share links and the list says when a
  document changed since its link, but an edited document's link still
  serves the old PDF); security F2 (a hand-written transfer with a
  non-string code or a negative amount still skips the derived
  confirmation — V3, a rules change) and F5 (V5). **Not fixed at
  `20260a0`:** security F7 (the attachment fallback fails open) and the
  server nits — the server round.
- **M1.6c (`7735410`, the server round) closed F7 and, by its author's
  account, the server nits:** attachments fail closed (decision 5),
  `overwrite:0` is signed, nothing internal leaks before the owner check
  (`startAdmin`), the owner email is compared exactly as the rules do, stale
  comments in `ma-server.js` and `ma-backup.js` were corrected, and share
  links record the document's revision (`docRev`), so the share panel can
  say a live link is of an older revision (money M3 — the link still serves
  the PDF it was made from). Its author verified it with 22 deliberate
  breaks, each caught by name (reported, not re-run here); its client half
  is `8e5fe0b`, whose four changes were each reverted once and caught by
  name.
- **The verification round's own new findings, V1–V12** (two blockers,
  V1 and V2, both in the sign-out work of decision 12), and a visual QA of
  the pages (F01–F27, 24 of them fixes and three judgement calls). V1–V11
  and F01–F24 are fixed in the two commits below; V12 is recorded only.
- **`0a0df4b` — the security fixes (29 Sept):**
  - **V1 (blocker)** "Use password instead" reopened the app with no
    fingerprint lock when the books could not come off the device. It now
    always signs out, the lock stays up until it has, and any reload is a
    cold start (decision 12).
  - **V2 (blocker)** an owner's sign-out deleted OTHER people's unsent
    offline writes. The queue is read first, and anything waiting — or a
    queue that cannot be read — keeps the copy (decision 12).
  - **V3** the rules never type- or sign-checked codes and amounts; now
    `maShapeOk` / `maCodeOk`, the edit row's clock window and field list,
    and `historical` against `goLive` (decision 2). By its author's
    account this closes V3's notes C3 and C5, and C1 and C2 only partly.
  - **V5** a Dashboard card kept its figures after the lock fell due
    (decision 11). **V7** a second Sign out said the books were KEPT
    while the first was deleting them — one way out per tab now. **V8**
    another open tab was left signed in but broken — it goes to the login.
    **V9** Master Accounts' fingerprint unlock opened the books with no
    fingerprint — `_lockDone(verified)`. **V11** `terminate` had no bound.
- **`44166f3` — the money and screen fixes (29 Sept, cherry-picked from
  `8f1a1df`):**
  - **V4 / F04** one rule for every cash total, `maHolderCash` ("The one
    balance read from elsewhere"). **V6** a new flag clears the review
    (decision 2). **V10** `maRsShort` picks its unit from the ROUNDED
    figure: ₨99,99,999 is "₨1 cr", never "₨100 lac".
  - **F03** a yearly bill opened before its first due day is upcoming, not
    overdue (`maCommitmentStatus` never looks back past `historyFrom`).
    **F05** Needs attention reads a period in words, uses the past tense
    for a day gone by, makes a part payment past its grace a concern, says
    "by you" to the one who confirms, and offers Confirm only to someone who
    can. **F19** a commitment whose amount varies is never ₨0: it adds
    nothing to the projection and every surface says "amount varies"
    (the Excel says "varies"). **F15** a rate is grouped the lakh way
    (`maRsRate`).
  - **The screens:** F01/F02 the header and the rail stick below the top
    bar (decision 13). F06 a holder's waiting transfers in date order, the
    whole row opens the transfer. F07 kinds, channels, periods and days in
    words. F08 "in October 2026" / "since Wed 1 Jul 2026", never "in Since
    …". F09 a switched-off commitment reads "off". F10 the audit trail's
    Document column does not wrap. F11 the word "void" is not struck out,
    the row's description and amount are. F12 "Would have posted" / "Posts
    once confirmed". F13 a phone form's select is full width. F14 phone
    tap targets ≥ 34px. F16 every calendar event is in its cell ("+N more"
    opens the day in the rail). F17 one rule above a phone total. F18 the
    skeleton and the error page sit inside `.ma-shell`. F20 under 1200px
    (1440px since F27) the rail stretches between the top bar and the foot
    and scrolls — at
    1024×768 a tall one had lost Edit, Void, Voucher (PDF) and Share
    voucher off the screen. F21 a due day never breaks. F22 the Parties
    filter is one row on a phone. F23 phone tabs wrap. F24 a section's
    actions wrap as one group.
- **`22cfd3e` and `c836de2` — Afnan's three calls (29 Sept), built on top
  of the fixes:** F26 folds the Record picker's eight later kinds behind
  one "Coming later · 8" button (a real button with `aria-expanded`, opened
  in place, folded again each time the picker opens, written nowhere); F27
  holds the slide-over up to 1440px (`@media (max-width:1440px)`, the
  rail's sticky column from 1441px); F25 is the "No opening balance yet"
  concern ("Where it stands"). **Checked by their author (reported, not
  re-run here):** for F26 and F27, 16 new reverts and 4 updated ones, all
  caught, the 78-entry revert script re-run on the rebased tree, all
  caught, axe over the picker folded and open in both themes (0
  violations), and Chromium at 1024–1600px in both themes; for F25, 10
  reverts, all caught, eleven existing assertions re-fixtured with an
  opening (none weakened), and a new layout fragment, "master accounts —
  Today on an empty book". **Re-run here:** the node suite at `22cfd3e`
  (9,524) and `c836de2` (9,549), `ma-fix-money` (155, then 180), and the
  fold, the 1440px rule and `maIsOpening` read in the code; the emulator
  and smoke suites are the merge agent's, on the final tip ("What is
  verified").
- **How they were checked.** Each fix was undone once and a named
  assertion failed — 27 reverts for the security fixes and 62 for the
  money and screens — **re-run by the integrator on a scratch copy of
  `1ae7e71`: all 89 caught, the security ones with exactly the failing
  counts their author reported.** The rules: see "What is verified". The
  real-SDK sign-out probe and the Chromium measurements behind F01/F02,
  F13/F14, F16, F20–F24 and the no-`:has()` fallback are the authors'
  (reported, not re-run). **No suite holds those behaviours** — the probes
  do not scroll, open a rail at 1024px or measure those controls — only
  the CSS or markup they rest on.
- **Still open, deliberately:**
  - **C1 and C2, partly** (decision 2): an edit can still store forged
    `flags`, and an edit row's `before` / `after` are not bound to the
    document. Owner-forgery only.
  - **C4 and V12, recorded only.** `byName` is free text, but the trail and
    its Excel print the name from `by` (decision 6). `isMasterAccounts()`
    trusts `token.email` without `email_verified` — adding the check would
    refuse Afnan and Ammar unless an admin marks both Auth accounts
    verified first (`@groovy.op` inboxes are not real), which is unknown
    from here; the whole rules file has the same shape.
  - **The period lock covers documents only**: `ma_accounts`,
    `ma_settings` (and so `goLive`) and `ma_parties` can still change after
    a close. No M1 screen closes a quarter (decision 7).
  - **Races reasoned about, not reproduced:** a write made in another tab
    between the queue read and the delete; a Sign out that ends in `stay`
    has already told this person's other tabs to go to the login (with
    Remember me, one shared sign-in, that signs this tab out too); a tab
    sent to the login that re-opens the database before the delete
    finishes; the Dashboard card's 30-second window (decision 11).
  - **iOS is unverified:** a frozen or restricted Safari tab hears the
    sign-out broadcast late, and its first tap then goes to the login.
    `:has()` and `overflow:clip` are unverified on real devices
    (decision 13).
  - **V4 depends on Raees** booking a handover in Store Accounts before an
    owner confirms it here.
  - **F27's cost, accepted with Afnan's call:** below 1441px an open rail
    covers the page header's Record and ⋯ buttons (at 1024px also Year and
    All); the rail's × closes it. F25, F26 and F27 themselves are built
    (the bullet above "How they were checked").

### What is verified, and how

- **Node suite** — re-run on a clean `git archive` of each commit: 6,612
  (`930c2df`, before M1) → 6,979 (M1.1) → 7,122 (M1.3) → 7,434 (M1.4) →
  7,778 (M1.5a) → 8,011 (M1.5b) → 8,201 (`704056b`) → **8,408
  (`20260a0`)**, all passing. Since then (the merges with `main`, the
  server round and the two verification-round fixes): 8,723 (`1dc7fa9`),
  8,788 (`feca515`), 8,794 (`efb75ce`), 8,797 (`be22046`), 8,832
  (`d159f83`), 8,980 (`7735410` — `ma-server` 78 → 142, `ma-attach` 74 →
  114, `ma-share` 107 → 151, each re-run here), 8,997 (`8e5fe0b`), 8,998
  (`f6125f8`); then 9,128 at `0a0df4b` and 9,126 at `8f1a1df` (each fix on
  its own — their authors' counts), **9,256 at `44166f3`** (both fixes:
  8,998 + 130 + 128), 9,429 at `1ae7e71` (the fifth merge with main, whose
  own count went 7,030 → 7,203 between the two merges: 9,256 + 173), 9,469
  at `5a36efe` (the sixth: main 7,203 → 7,243, + 40), 9,497 at `672cf4f`
  (the seventh: main 7,243 → 7,271, + 28), 9,524 at `22cfd3e` (F26 and
  F27, + 27), 9,549 at `c836de2` (F25, + 25), 9,586 at `69f5c72` (the
  eighth merge, + 37), 9,735 at `8573391` (the ninth merge and the
  QA-guard adaptation, + 149: the merge agent reports main + 129 and 20
  new guard and snapshot tests) and **9,753 at `a436e8b`** (the tenth
  merge, main's Pantone C tab, + 18; the eleventh is docs only, + 0).
  Every count from 9,524 on was re-run here, all passing; the merge agent
  reported the same 9,753 at `51cf6c3`.
- **Rules, in the real Firestore emulator** — against the merged
  `firestore.rules` at `51cf6c3` (the FINAL file: LF md5 `9d7ec162…`,
  1,526 lines; the merge agent ran the suites below on `8573391`'s tree —
  reported, read from its logs, not re-run here — and the file is
  byte-identical at the tenth and eleventh merges; the earlier runs of the
  first four, against `acc9a3a1…`, were at `1ae7e71` and again at
  `672cf4f`, with the same results):
  `tests/rules-emulator-ma.js` **241 / 241** (209 + V3's 32: 22 "V3:"
  attacks, 8 "V3 control:" writes the app makes, 2 builder checks), and
  main's own suites `rules-emulator.js` 103 / 103,
  `rules-emulator-board.js` **100 / 100** (39 before main's QA fences) and
  `rules-emulator-boards.js` 26 / 26, and main's QA suites
  `rules-emulator-qa.js` 604 / 604 (its part 1b holds that the QA account is
  REFUSED on every `ma_*` path), `rules-emulator-rtdb.js` 9 / 9,
  `qa-probe-emulator.js` 5 / 5 and `qa-snapshot-emulator.js` 31 / 31; the
  V6 write, from a scratch copy of the money fixer's check stamped with the
  time the app stamps, 5 / 5 (against the earlier file). The
  same Master Accounts file **against earlier rules**: `bef4dc4`'s
  (`8cf1c681…`, the merge before V3) fails exactly the 22 "V3:" attacks;
  `1d8b3c5`'s (the ones reported published) fails **84** — the 55 "M1.6a:"
  attacks, 21 of the 22 "V3:" attacks (the 22nd, an edit row naming only
  `flags`, those rules refuse anyway: their `maEditOk` lists no `flags`)
  and 8 writes the app makes that they refuse (an edit storing the flags it
  raised, three ways; an edit that clears a review; four re-lock cases).
  That is what makes the republish necessary rather than cosmetic.
- **Layout and the smoke suites** — re-run by the integrator on a clean
  `git archive` of `672cf4f` (and of `5a36efe`, `1ae7e71`, of `44166f3` —
  the two fixes before main came in — and earlier of `1f06da2`, `efb75ce`,
  `be22046` and `d159f83`, with the same results): `smoke-layout` 466 / 466
  at `672cf4f` (462 before main's new Pick-colour fragment). **At the final
  tip, `51cf6c3`, the merge agent ran them again (reported; read from its
  logs, not re-run here): `smoke-layout` 484 / 484**, of which 82 jobs are
  the fifteen `master accounts — …` fragments (counted in that log; every
  width they
  declare, both themes: contrast, overflow, clipped text and hit-testing;
  since `8e5fe0b` the attachment-mode fragment also renders the
  switched-off card); `smoke-app-phone` clean on all 53 of the owner's pages
  in both themes — the six `ma-*` nav pages among them — and on the pages
  it lists for six other roles; `smoke-phone` 30 / 30; `smoke-board` (187
  / 192 / 192 checks at `51cf6c3` (reported, above), with main's new ones; 172 / 177 / 177
  before), `smoke-browser` 8 / 8 and `smoke-startapp` (all four read
  conditions) pass. **`smoke-axe` scans the six `ma-*` pages since `1f06da2`** (over a
  small book built by `js/ma-core.js`; before, its list had none): no
  violation on any of them, and no rule/page pair beyond
  `tests/axe-baseline.json`. Its list does not open the Record picker, the
  forms, the document rail or the share panel; scanned once from a scratch
  copy of its driver, those showed one moderate `heading-order` finding —
  the document rail's `<h3 class="ma-rail-title">` follows the page's
  `<h1>` with no `<h2>` between — left as it is. None of these suites signs
  in to the real Firebase: every page is rendered against fake data.
  **Outside `tests/run.js` and CI:** `tests/e2e/board.e2e.js` — only its
  stub mode could run at the tip — 153 / 157 (the merge agent, reported). *(29 Sept 2026,
  later: its LIVE mode was run as the QA account against the served site — 6 of 7, see "QA debug
  access".)*
  The same four checks fail identically on `main`'s own checkout at
  `08b530a` (a calendar pill title is ellipsised at 1440px in that
  harness), so the merges did not cause them.
- **The print engine** — every variant that existed before M1.4 (`generic`,
  the `qc-report` fallback, `stock-transfer`, `consumable-log`,
  `daily-performance`, `payslip`, `gate-pass`, `po`, `mood-board`,
  `pattern-label`) makes the same jsPDF calls, in the same order, at
  `704056b` as at `930c2df`, with and without a landscape request
  (re-run with a recording fake jsPDF on the Helvetica path — the
  embedded-font path was not exercised); M1.6b changed `_renderMaLedger`
  only. The one new behaviour: `generic` asked for landscape now builds
  landscape; no caller outside Master Accounts passes `orientation` or
  `deliver` (checked by grep).
- **The five Master Accounts PDFs** were rendered through pdf.js in
  headless Chromium and looked at, page by page, for M1.4 (the test
  file's header says so; not re-done here).
- **Not verifiable from a session, and not done:** anything on a real
  screen or a phone; what the Console has published (see the rules
  record); the Cloudinary account's plan (authenticated delivery, the
  download API, its upload cap — ~~`cloudinary.com` is unreachable from the
  sandbox~~ *SUPERSEDED 29 Sept 2026: the public hosts answer; the plan is an account setting that
  needs its login*); the backup bucket, the service account's roles and PITR; what
  WhatsApp does with a link. The first real upload, share and 03:30 UTC
  run are the tests, and each writes or shows its own result.

### Set-up only a human can do

One of these is done and verified — the merge into `main`, with Afnan's
go-ahead (29 Sept 2026; `main` read from git as `914b67a`) — and one thing
is REPORTED done by Afnan, not checkable: the rules publish (the two rules
items below, left unticked — a report is not a check). ~~Nothing else is done
or checked as of that day.~~ *(30 Sept 2026: one more thing is REPORTED, not
re-run — PR #100, merged into `main` on 29 Sept 2026, records that `sw.js`,
`index.html`, `js/master-accounts.js` and `js/ma-core.js` served by
`groovyoperations.netlify.app` at 16:39 UTC that day were byte-identical to
`origin/main`'s, read by another session; this session's `curl` to that host
failed on 30 Sept, "CONNECT tunnel failed, response 403". The Netlify deploy LIST
is still unseen, and nothing else here is done or checked.)* ~~The sandbox cannot reach Google Cloud, Netlify's
settings, Cloudinary or the Firebase Console, so each is Afnan's~~ *(29 Sept 2026,
corrected: the public hosts answer from a session; the consoles and dashboards themselves —
Google Cloud, Netlify, Cloudinary's account, the Firebase Console — were not opened, so each
stays Afnan's)* (the full steps are handed to him in chat, not kept here).

- [ ] **Which rules are live** — **reported done by Afnan, not checkable.**
  He wrote "rules updated" at about 16:18 UTC on 29 Sept 2026 and did not
  name the file (hypothesis, unverified: the FINAL `9d7ec162…`). Two
  publishes had been reported earlier that day — Afnan's merged file
  `acc9a3a1…` and, in `main`'s record, Ammar's `7d858a05…` (no `ma_*`
  block) — and `main`'s record adds that the file live before Ammar's paste
  matched no committed version. *Only the Console knows (Firebase Console →
  Firestore → Rules history). A Master Accounts page that says "could not
  read … republish" means the Master Accounts block is not live.* The 29 Sept live probe as the
  QA account (all 15 `ma_*` lists 403) is consistent with either file and does not settle it.
- [ ] **The backup bucket** (`gs://…`, same location as Firestore, public
  access prevention on, delete after 90 days) — *unverified advice, from
  the plan.*
- [ ] **The service account's roles**: Cloud Datastore Import Export Admin
  on the project, Storage Object Admin on the bucket — *the first backup
  run is the test; a failure writes Google's own words into its row.*
- [ ] **Point-in-time recovery**, 7 days — *nothing in the app can see it.*
- [ ] **Netlify env vars, then a redeploy:** `MA_BACKUP_BUCKET`,
  `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`. **Until the two
  Cloudinary keys are set, attachments and share links are OFF** (M1.6c) —
  Close & audit → Settings says "Attachments are off — not set up."
  `MA_ALLOW_PUBLIC_ATTACH=1` only for deliberate public files: they then go
  up public and stay public after the keys are set. *Unverifiable from
  here: whether the account accepts `overwrite=0` on authenticated uploads,
  what it does with a replayed upload — the first real upload is the
  test.*
- [ ] **The Cloudinary plan**: its upload cap (the app allows 25 MB), and
  whether it allows authenticated uploads and the download API —
  *unverifiable from here.*
- [ ] **Publish the FINAL `firestore.rules`** — **reported done by Afnan
  (about 16:18 UTC, 29 Sept 2026), not checkable** — the file on `main` now:
  LF md5 `9d7ec162b9812b5358d2ce07a400824a`, 1,526 lines (`main`'s file with
  the QA-read rules and the uid pin, plus the Master Accounts block with
  M1.6a and V3); that it is what he pasted is a hypothesis, unverified.
  **From the repo file, not a local copy** (`main`'s record: the file live
  before Ammar's paste came from a local file on Afnan's PC and matched no
  committed version). Neither of the two earlier reported pastes was this
  file: Afnan's `acc9a3a1…` (1,502 lines) lacks the QA-read rules, and
  Ammar's `7d858a05…` (1,142 lines) lacks the Master Accounts block — if
  Ammar's were still the live one, Master Accounts is denied for everyone.
  `main`'s record names the Firebase CLI as a publish route (`firebase
  deploy --only firestore:rules`, from Afnan's machine); it deploys the
  checkout it runs in, so from `main` at or after the merge it carries
  Master Accounts, and from `main` before it, it would take the block out.
  `main`'s own entry (in "Firestore rules — published", just below the
  FINAL-file entry) records the backup and the live probe.
- [x] **Merge into `main`** — **done on 29 Sept 2026, with Afnan's
  go-ahead** (verified: `git ls-remote origin refs/heads/main` read
  `914b67a…` at 16:24 UTC): `main` was fast-forwarded to `a436e8b` and then
  to `914b67a` (the branch's tip then), after the eleventh merge of `main`
  into the branch (`a436e8b`). GitHub Actions `tests` on `main` completed
  with success for both (read at about 16:25 UTC). ~~**Whether Netlify built
  it is unconfirmed** until Afnan reads the Netlify deploy list — a skipped
  deploy looks exactly like a stale cache.~~ *(30 Sept 2026: PR #100 REPORTS that
  the served `sw.js`, `index.html`, `js/master-accounts.js` and `js/ma-core.js`
  were byte-identical to `origin/main`'s at 16:39 UTC on 29 Sept, so a build
  containing Master Accounts was live — reported here, read by another session,
  not re-run: this session's `curl` failed. The deploy LIST is still unseen, and
  a skipped deploy looks exactly like a stale cache.)*
- [ ] **Read the Netlify deploy list for that merge** — was it built, or
  skipped (the 21 Sept credit-usage skip looked exactly like a stale
  cache)? ~~*Only Afnan can see it: `*.netlify.app` is blocked here and the
  repo carries no Netlify commit statuses.*~~ *(29 Sept 2026, corrected: the site answers from
  a session and its `sw.js`, `index.html`, `js/master-accounts.js` and `js/ma-core.js` were
  byte-identical to `origin/main`'s, so a build containing Master Accounts IS live — see the
  "On `main` since" bullet. The deploy LIST would still say whether the docs commits after
  `51cf6c3` were skipped, which commit built the served bytes, and whether the `ma-*` functions
  deployed; the repo carries no Netlify commit statuses, and that view is Afnan's.)* Left
  unticked: the list itself has not been seen.
- [ ] **A first look on a real screen** — nobody has.

### Cross-track

`js/embellishments.js` (one `typeof`-guarded dashboard widget call),
`js/print-engine.js` (additive — landscape, blob delivery, five variants,
`_prMaUrduOk`, and `balanceHidden` on the ledger since M1.6b),
`js/shared.js` (the nav section, the More sheet, one `ma-*` `renderPage`
line, the dashboard `setTimeout`, the phone `groups` map, `BUG_PAGE_NAMES`,
the sub-nav expand in `showPage`), `js/auth.js` (M1.6b: `doLogout` and
`lockUsePassword` call `window.maBooksOffDevice()` behind `typeof`; since
`0a0df4b`: `_authLeave` — one way out per tab — `_lockLeaving`, a
`lockUsePassword` that always signs out, a `doLogout` that reloads cold
when the lock came up meanwhile, and `_lockDone(verified)`),
`css/main.css` (one `.ma-` block, after The Board's rules — since the 29
Sept merge main's Mood Boards swatch block follows it; since `44166f3` it
carries the three `:has(>.ma-shell)` selectors of decision 13), `index.html` (two
script tags after `theboard.js`, `?v` strings, and M1.6b's three Firebase
bridges: `terminate`, `clearIndexedDbPersistence`, `waitForPendingWrites`),
`sw.js` (`CACHE_VERSION`, two precache entries, the private-Cloudinary
exclusion), `netlify.toml` (the backup schedule), `firestore.rules` (the
Master Accounts block), two shared probes (`smoke-app-phone.js`,
`smoke-layout.js`), and, since the ninth merge, `main`'s QA guard and
snapshot files, edited here to name the `ma_*` exemption (`8573391`):
`tests/qa-read-guard.test.js`, `tests/rules-emulator-qa.js`,
`tests/qa-snapshot.test.js`, `tests/qa-snapshot-emulator.js`,
`tools/qa-snapshot-lib.js` and `tools/qa-snapshot.js`. The exact list, by
function name, is a note drafted
for Ammar's session, outside the repo, to reach him through Afnan; whether
it has is unverified.

**Merging with `main` is a real merge, and it has been done eleven
times — then the branch went into `main`.** The branch had not taken `main` since `2298f39`. `1dc7fa9`
merged `origin/main` at `1f6327d` (v246): conflicts in `index.html`
(`?v` strings) and `sw.js` (`CACHE_VERSION`), and `firestore.rules`,
`js/shared.js`, `css/main.css`, `CLAUDE.md`, `netlify.toml` and
`tests/smoke-layout.js` merged cleanly and were checked line by line to
carry both sides. **Then the dangerous shape happened for real, three
times:**
`main` moved to `4eea411`, which took **v247** — the number `1dc7fa9`
had just taken — for different bytes, and `4c8bfee` (v248). Nothing had
been pushed yet, so `feca515` merged again and went to v249, past both;
its conflicts were `index.html`, `sw.js` and, this time, `css/main.css`
(both sides appended a block at the end of the file — both kept, `.ma-`
first). Then `main`'s `3333584` took **v249** — `feca515`'s number — for
different bytes. The branch had moved on to v250 (`efb75ce`), so this
time the two lines differed and git raised the conflict; `be22046` went
to v251. And while the docs were being written, `main`'s `dc0e609` took
**v250** — `efb75ce`'s number — and `d159f83` went to v252 (`main` took
four commits between 21:43 and 07:26 UTC, the last two 27 minutes
apart). **The fifth time, 29 Sept, while the verification round's fixes
were being combined:** `main` merged PR #91 (`e1f84bf` — the QA identity,
Creative Hub renamed Milanote, no browser dialogs in Mood Boards) at
**v251**, `be22046`'s number, for different bytes; the branch was at v253,
so git raised the conflict, and `1ae7e71` went to v254. Its only
conflicts were `sw.js` and the `?v=` strings; `CLAUDE.md`,
`css/main.css`, `firestore.rules`, `js/auth.js` and `js/shared.js` merged
cleanly, and each equals an independent `git merge-file` of the three
versions and passes a line-multiset check. **And the fetch just before
pushing found `main` had moved again** — `bac4848` (Mood Boards' Pick
colour, v252) — so `5a36efe` merged it too and took v255: `sw.js` and
the `css/main.css` tag conflicted, `CLAUDE.md`, `css/main.css` and
`tests/smoke-layout.js` merged cleanly (checked the same way), and
`firestore.rules` did not change. **Then it moved once more**, `d1af808`
(Mood Boards: a picture for a link that has none, v253), and `672cf4f`
took it the same way, at v256. After that the push went out without
chasing `main` further: keeping the branch current is needed only before
it is merged INTO `main`, and the branch is not deployed on its own.
**The eighth, `69f5c72`** (`5996999`: the Color Library's TCX codes tab,
v254), took v257: only `sw.js` and the `?v=` strings conflicted, and
`CLAUDE.md`, `css/main.css`, `js/embellishments.js` and
`tests/smoke-layout.js` merged cleanly (checked the same way). **The ninth,
`ef7eabb`** (`08b530a`, v255: main's QA-account work — `isQaRead()` on
every read rule, a uid pin in `isQa()`, `js/env.js`, `QA_ACCESS.md`,
`tools/qa-*.js`, seven new QA test files) took v258. Conflicts: `sw.js`
(v257 against v255) and `index.html` — the `/js/env.js` script tag beside
the branch's newer `?v=` tags, and the module import line, hand-combined
into the union of both sides' names (23: main's emulator switch plus the
branch's `terminate`, `clearIndexedDbPersistence` and
`waitForPendingWrites`); `CLAUDE.md` and `firestore.rules` merged cleanly,
each equal to an independent `git merge-file` (the rules now 1,526 lines).
**On its own it failed three of `main`'s new QA-guard checks** (its own
commit message says so) — the 15 `ma_*` read rules are owner-only on
purpose, so they do not start with `isQaRead()`; `8573391` adapts the guard,
and the two were pushed together. **The tenth, `51cf6c3`** (`1b56a46`, v256:
the Color Library's Pantone C tab and Milanote opening on Mood Boards) took
v259: `sw.js` and the `?v=` strings conflicted; `firestore.rules` and
`css/main.css` were not changed by main. **The eleventh, `a436e8b`**
(`11bd681`, docs only, v256) changed `CLAUDE.md` alone (+19 lines,
byte-identical to an independent `git merge-file`, re-checked here) and took
no version. **After it `main` was fast-forwarded to the branch tip on 29
Sept 2026, with Afnan's go-ahead.** Every future merge: fetch, compare
`CACHE_VERSION` on both sides, not just the conflict list, bump past both,
and fetch again just before pushing.

### The planning record (27–28 Sept 2026), condensed

**Four versions in two days; v4 is what M1 was built from.** v1 was a
reporting layer over other modules' entries (*"you thought like baby
accounts"*). v2 made the master ledger the system of record: one chart of
accounts, ONE party master (vendor, customer, courier, gateway, employee,
owner, bank) with terms and a rate card kept with history, documents with
a lifecycle, a validation engine that REFUSES what cannot be true and FLAGS
the rest, per-party ledgers, costing per production PO. **v3 put the cash
under it, as Afnan stated it** (the plan's §0a — an owner's account, not
code-verified): 90% of the money arrives as PostEx CPRs on Tuesday and
Friday and is collected BY HAND, so money is modelled by HOLDER and the
couriers are built before purchasing (a CPR is derived nightly from
`postex_orders`, only the collection is typed); TCS credits its own account
at 90 days, Blue-Ex is a legacy receivable, Bykea lands with Raees; Payfast
pays out on weekdays, daily, some days skipped, into the owners' savings —
a SECOND BOOK — and the ~₨15 lac Groovy borrowed from it is ONE document
posting on both books; Asghar is a vendor like any other (Afnan, overruling
the plan's first "affiliate" idea); every document carries a tax block
("no tax" is a choice, never an absence); the books close by the quarter on
a fiscal year from 1 July; and "the money speaks" (fine / watch / concern
on every line of spend, a spend map, a cash calendar). **v4 (28 Sept)**
answered *"a whole world of my money … you're 5% there"*: the money map of
what the code holds today (§25), the cost register (§26), labels on every
posting (§27), the coverage register (§28), the former open questions
turned into rules with defaults (§23), security, backup, print and share as
foundations (§29–§31), and ten pages mapped desktop-first (§16).

**The specimen and the two design reports.** The UI specimen is
`scratchpad/master-accounts-specimen.html`, published at
https://claude.ai/artifact/9bmhjEuaZMisWLb2TiQNyZ (private to its owner
until shared), rebuilt to §16 on 28 Sept. The visual rules came from two
subagent reports committed as model output —
`scratchpad/master-accounts-visual-audit.md` (the v3 specimen MEASURED in
headless Chromium: the overview 2,532px tall, 82% of its text at 12px or
under, 66 bordered boxes, the first chart at y=1,183) and
`scratchpad/master-accounts-design-systems.md` (Polaris, Carbon and Primer
read over `raw.githubusercontent.com`); where they disagreed, the audit's
number stood. The rebuilt specimen measured Today's main column at 2,299px,
6 bordered boxes, 0 uppercase labels, 0 text under 11px, the first chart at
y=422, nothing under 2.2:1 in either theme. The module inside the app was
built to the same rules — the `.ma-` block's header in `css/main.css`
lists them (the 4·8·12·16·24·32 spacing steps, a 22/600 title, 14px body,
tabular figures, no uppercase, nothing under 12px, no shadows, tokens
only).

**Verified while planning, still true of M1** (file:line in the plan's
§1): nothing in HRM records HOW a salary was paid; a Shopify order is
written once, never updated, and carries NO gateway field, so COD and
Payfast orders cannot be told apart; PostEx is the only remittance data in
the app and nothing records that a CPR's cash was collected;
`printing_billing` is a payable with no payee field; no cost of goods
exists anywhere (no fabric rate, no CMT rate); and Reset Store Accounts
deletes the very ledger the drawer mirror reads (retired at M8).

**The class collision, carried into the build.** The specimen's calendar
cell wore `today`, a class the same stylesheet already used for a
`position:absolute` marker, and it painted as a full-height stripe down the
page; it became `cal-today`. **Every rule added to `css/main.css` for this
module is `.ma-`-scoped for that reason** — the `tb` lesson from The Board,
in CSS.

## Master Accounts — M2 built (30 Sept 2026) · couriers and collections · on `main` at `6410744`, rules reported published (30 Sept), not yet seen

Afnan, 29 Sept 2026 (as relayed to the session that built it): after the
foundation, the money that actually arrives — PostEx's receipts (CPRs)
collected by hand, and TCS, Blue-Ex and Bykea. That is §21's **M2 "Couriers &
collections"**; **`MASTER_ACCOUNTS_PLAN.md` §21b** says where the build differs
from the plan. **Progress: 2 of the 11 build milestones (M1–M11), about 18%.**
Where the M1 section above says 15 `ma_*` collections, eight `ma-*` page ids,
nine live Record kinds or a picker folding "Coming later · 8", M2 made them
**19, nine, eleven and 7** (verified: `grep -c 'match /ma_' firestore.rules`,
`MA_PAGES`, `_MA_TILES`).

**Where it stands — verified from git, 30 Sept.** Nineteen commits since
`fa44f86` (the five PR #100 docs commits in that range are not M2's), every one
an ancestor of `origin/main` (`git merge-base --is-ancestor`); `git ls-remote
origin refs/heads/main` read `64107447b8c46e2a77e48c0d9d5d031de3241102` on 30
Sept, the branch tip. In order: the PostEx enrichment `1fda9dd` (`0adad4e` merges
PR #100 into it), fixed by `e2827dd`; the derivation `9c29bd7`; the core `90a98a9`
(`c1506d2`); the nightly rollup `138aa9c`; the rules `0a5b6d6` (`7dbc513`); the
receipt PDF `7f6f0af`; the screens `7e41206`. Then the review round, three
fixers built side by side from `7e41206`: **B** `565eecc` (rollup, PostEx); **A**
`53ba832` (page, core, rules — `33d87a1` merges B, `74abf80` is its emulator
proof); **C** `a1cbb32` (display — `ad9f39e` merges B, `0c91285` re-numbers the
cache, `6410744` merges A's proof). The trailers name Opus 5.5 on the build and
on A, Sonnet 5.5 on B and C (read from the 13 non-merge commits).

- **On `main`; the deploy list was not read.** **`CACHE_VERSION` is `v269`:** A
  and C both started at v265, B took v266, C then v267 and A's proof v268 (`sw.js`
  read at each commit), and the last merge — conflicts in `index.html`,
  `js/master-accounts.js` and `sw.js`, by its own message — went past all of them.
- **The rules: sent 30 Sept, REPORTED published 30 Sept — not checkable.**
  `firestore.rules` at `6410744`: LF md5 `85ac93b115c0c75ba0213d7371cc6958`, 1,748
  lines, and the same bytes at `ca325c1` (verified). Sent to Afnan on 30 Sept
  from `main` at `ca325c1` (as relayed); he wrote "done rules updated" at about
  12:23 UTC that day (as relayed) — a report: his message did not name the file,
  and nobody in a session can read the Console. **Hypothesis, unverified: the
  file he published is this one.** An earlier M2 file — md5
  `d56929aa04f40928de3e0ea14a449442`, 1,675 lines, the file at `0a5b6d6`
  (verified) — was sent on 29 Sept, never reported published, and is superseded
  (it has no `ma_claims` block and no dispute-history rule). ~~**Until the M2
  file is published**, no file reported published holds a rule for `ma_cpr`,
  `ma_collection`, `ma_claims` or `ma_runs`, so those reads are default-denied,
  owners included: dependent figures say "incomplete — <collection> could not
  be read" and the rest of Master Accounts carries on, and **collection, claim,
  dispute and courier-statement writes are refused**.~~ *(SUPERSEDED 30 Sept
  2026, ~12:23 UTC, by the report above — hypothesis, unverified: if he
  published the M2 file, those reads and writes are no longer refused and
  "incomplete — <collection> could not be read" should clear; if it was another
  file, the Console may still hold the FINAL M1 file, which has no rule for the
  four collections, and all of that stands.)* See "Firestore rules —
  published".
- **Served? Not known.** This session's `curl` to `groovyoperations.netlify.app`
  failed ("CONNECT tunnel failed, response 403"). PR #100's 29 Sept read of the
  served bytes was of M1's build (`v259`), is *reported* here and not re-run, and
  says nothing of `v269`.
- **Nobody has seen M2 on a screen or run the rollup for real.** The pages are
  owner-only and the QA account is refused on `ma_*` by design ("The gate"), so
  no session can open them on live data. Every visual claim below is headless
  Chromium.

### What is where

- **`js/ma-core.js`** (3,631 lines; 2,326 before), pure: `MA_COURIERS` (four
  couriers, their cycles and accounts), `maCprDerive` (parcels → receipts, days,
  transit, opening, data issues; nothing posts), `maCprNet` (THE net of one
  receipt), `maCourierDocs` / `Merge` / `Gone` / `Plan` (what the rollup writes),
  typed statements and collections (document types `cpr`, `CS-27-0001`, and
  `collection`, `CL-27-0001`), claims, disputes, `maCourierInflows`,
  `maCourierConcerns`, `maPdfCollectionData`.
- **`js/master-accounts.js`** (4,179; 3,134 before): **Money in ▸ Couriers, page
  `ma-in`** (one section per courier: a summary, PostEx's transit and the
  rollup's "as of", what is not yet collected with a tick each, **Record
  collection**, recent collections, an owner-only **Run now**), the rail for a
  receipt, statement or collection, both forms, and three NON-core reads (a
  refused one never reaches the error card). The Record picker has 11 live kinds.
- **New:** `netlify/functions/ma-rollup-background.js` (382 lines) and
  `ma-rollup-now-background.js` (32). **Changed:** `netlify/lib/postex-core.js`
  (+234 −35), `js/print-engine.js` (+121 −5: the **`ma-collection`** PDF, A5),
  `js/fulfillment.js` (+5 −1), `js/shared.js` (+2 −1: `ma-in` in the phone groups
  map and `BUG_PAGE_NAMES`), `css/main.css` (+63, all `.ma-`), `netlify.toml`
  (+6), `ma-backup.js` (exports the four new collections), `ma-server.js`
  (`rollup` is a server audit action), `index.html` (`?v=` strings), `sw.js`
  (`CACHE_VERSION` only; no `PRECACHE_URLS` change). No index change; no new env
  var (`FIREBASE_SERVICE_ACCOUNT`, as the other functions).
- **Collections** (owner-only read, none deletable; each read rule is
  `isMasterAccounts()` alone, so QA is refused): **`ma_cpr`** (PostEx's derived
  days, opening and receipts — written only by the rollup — and TCS / Bykea
  statements typed by an owner), **`ma_collection`**, **`ma_claims`** (one live
  collection per receipt), **`ma_runs`** (`ma_runs/rollup`, the last run;
  server-write only). The rollup also writes one `ma_audit` row a run
  (`by:'ma-rollup'`). The TCS account, 1060, is switched on (it was
  `active:false, arrives:'M2'`). The file now has 110 `allow read` lines: 91 with
  `isQaRead()` and 19 without, all `ma_*` (verified: `grep`).

### The decisions that hold it up — with the reasons

**Afnan, 29 Sept 2026 (as relayed; not in the repo):**

1. **A PostEx sale is income the day PostEx marks the parcel delivered** — not at
   the CPR, not at the cash (also in `maCprDerive`'s header). A delivery day is
   one derived document (`postex-day-<day>`, `PX-YYMMDD`): COD Dr 1120 / Cr 4010,
   PostEx's fee and tax as costs. A receipt only moves its net 1120 → 1121; a
   collection moves the cash in (Dr the holder / Cr 1121 — the courier's own
   receivable for the other three — the difference to 9030).
2. **The books start on 1 July 2026**: the opening balance is dated then and
   July–September is back-entered (plan §3 #15 says the same; `historyFrom` and
   `couriers.from` are `2026-07-01`). PostEx's part of the opening is DERIVED
   (`PX-OPEN`, what it owed at the start), never typed (B1).
3. **A collection with no receipt photo is saved and flagged while attachments
   are off, refused once they are on** ("Decision 3", `_maAttachRule`); "off" is
   M1.6c's not-configured state or an answer that could not be had.
4. Process: each piece goes to `main` as it passes its tests; each agent's model
   is chosen by the task.

**The main session's calls (tabled to be overruled, §21b):**

5. A courier statement follows decision 3 too.
6. **The calendar places only the expected UPFRONT share** of PostEx's
   delivered-not-on-a-CPR money, on the next CPR day + `collectLagDays`, marked
   an estimate (`maCourierInflows`); an uncollected statement on its expected
   day, TCS's at its last line + `tcsCreditDays`, never spendable.
7. **Blue-Ex's opening is a line on the ONE opening journal** (1123); it has no
   statements, and a collection is against that balance.
8. **No stat tiles on Money in** (plan §16.4). Returns' reversal fee and tax post
   to **5070**, a delivery's fee and tax to 5060. **Fees are posted at delivery,
   not per CPR** — one definition of a parcel's cost, so with every receipt in
   the days' COD less charges equals the receipts' nets and 1120 clears (held on
   fixtures, not against a PostEx receipt). **Courier GST is a cost** unless
   `settings.couriers.<courier>.taxClaimable` (false for all four; true posts to
   1160).
9. **The rollup is a scheduled background function** (`ma-rollup-background`,
   `45 3 * * *` UTC = 08:45 PKT, after the 03:00 UTC PostEx payments run) **plus
   an on-demand wrapper** (`ma-rollup-now-background`: the owner's ID token,
   `verifyOwner`, 202 at once; the page polls `ma_runs/rollup`). Netlify answers a
   scheduled function's URL with 403 — hence the wrapper. It writes `ma_cpr`
   documents, the run and an audit row, and nothing else: no balance is stored
   and nothing is learned (§19 had it recompute the trial balance and write
   learned inflows).
10. **M5 must not post PostEx COD a second time.** The days already book each
    delivered parcel's COD on 4010; plan §3 #20 has M5 invoice each Shopify order
    "with the gateway deciding the receivable (COD → the courier)", which built
    as written books it twice. Written down, not built.
11. **S6 (the quarter lock reads only a document's own date) is deferred to
    M11.** An M2 document posts on other days — a statement's lines on their
    delivery days, a collection's opening pair on the books' first day. No screen
    closes a quarter yet; the lock must cover every quarter a document posts into
    before one does (KNOWN GAP comments in `maQuarterLocked` and the rules'
    `maLocked`).
12. **Courier terms live in `settings.couriers`, not on party records — unlike
    the plan** (§4.2: `cycle`, `collectBy`, `collectLagDays`, `creditDays`,
    `tolerancePct`, `feeCard`, `openingStatement`). `MA_COURIERS` is code; `cprDays`,
    `tcsCreditDays`, `courierTolerancePct` are M1's settings; the new block holds
    `from`, `runWatchHours` (36) and per courier `collectLagDays`,
    `uncollectedDays`, `taxClaimable`, `beforeWindowDays` (PostEx 1 / 3 / false /
    31; TCS 0 / 7; Blue-Ex 0 / 0; Bykea 2 / 7). **No screen edits it** (the pages
    only read it; the Settings save keeps keys it does not know); the party form
    has no courier fields; there is no fee card.

**From the design.** A receipt is derived per receipt NUMBER (a parcel on two is
two parts, never doubled); `maCprNet` is THE net, each figure a whole rupee
rounded ONCE per parcel (S1: at most half a rupee a parcel off PostEx's
paisa-exact total); a return is charged `reversalFee + reversalTax`; the upfront
and reserve parts are PostEx's own `upfrontPayment` / `reservePayment` (else the
share less the other) — **unverified against a real CPR PDF**. A collection is
cash counted against up to 40 receipts or statements with a SNAPSHOT of what it
covered, so a later change is seen, never absorbed; a difference posts to 9030
and needs a reason past 1%; a receipt dated up to `beforeWindowDays` (31 for
PostEx) before the books stays collectable against the opening. Who confirms is
M1's `MA_HANDS` map: a recorder who IS the holder's person has confirmed by
recording — except into the drawer, which waits for Raees (an owner confirms on
paper); MCB and the TCS account post at once. Statements are typed for TCS and
Bykea only; a derived document is the rollup's — an owner may only review or
dispute it; nothing is deleted.

### The PostEx enrichment (`netlify/lib/postex-core.js`, `js/fulfillment.js`)

M2 needs each parcel's reserve receipt (`cprNumber_2`, `cpr2Date`), `settle` and
`settlementDate`. `enrichPayments` skipped a parcel for good once it held EITHER
receipt number and wrote `x || null` with merge, blanking stored values (`1fda9dd`'s
message, read against the code). It runs daily at 03:00 UTC
(`postex-payments-background`; the on-demand `?limit=` takes up to 9,000). Now:

- **A parcel is asked until FINISHED:** settled; both numbers in (a RETURN only
  when settled); or given up. One query as before (eleven fields projected, no
  index); the `payments_run` summary keeps its keys and adds ten counters
  (`awaitingCpr`, `reservedForRecheck`, `conflicts`, `gaveUp`, …).
- **`cprRecheckedAt`** is stamped by every ANSWERED re-check, never by the check
  that finds a receipt (a failed request moves nothing), so every parcel enriched
  earlier gets one more ask. **The give-up window is 120 days** from the first
  receipt (`cpr1Date`, `upfrontPaymentDate`, `cpr2Date`, `transactionDate`),
  closing only on a parcel re-checked since — **120 is an assumption; how long a
  reserve receipt takes is not known.**
- **Throttles and a floor:** a parcel holding a receipt is re-asked at most every
  3 days less an hour, one with none at most once a day, and when re-checks are
  due **25% of the per-run limit is kept for them** (`ceil(limit × 0.25)`, capped
  at how many are due; what they do not use goes back to the parcels with no
  receipt). The scheduled default limit is 500.
- **Only values PostEx gave are written**, `settle` only ever as true. **Receipt
  numbers are first-wins:** a DIFFERENT non-blank number is not written;
  `cprConflict {field, stored, received, at}` records it and the run counts it.
  Since `565eecc` (S8) the receipt's DATE goes with its number only — before, a
  conflict wrote the new receipt's date under the old number.
- **The CPR tab shows a receipt's OWN date** (upfront date for the upfront
  number, reserve date for the reserve number; else settlement, else the other's
  — was `settlementDate || cpr1Date || cpr2Date`). **Only the date changed:** the
  tab still nets a parcel whole to one receipt by its forward fee and tax, where
  `maCprNet` splits it and charges a return `reversalFee + reversalTax` — the two
  screens can show different nets for one number (read from both).

### The review round (29–30 Sept)

Two reviews ran against `7e41206`: money / security (B1, S1–S8, notes 1–3) and
screens (#1–#6). **Their reports are session scratch, not in the repo**; the
findings are those the commits, comments and `tests/master-accounts-m2-review.test.js`
name. Each fix was undone once and a named assertion failed — B 31 undos, A 22
(page, core) and 8 (rules), C 32 — **reported, not re-run**.

- **S3 (B) — the rollup overwrote owners' work.** It planned from one read, then
  overwrote whole documents: a receipt collected mid-run was voided anyway (1121
  short), a dispute or review opened mid-run was erased. Now each update and void
  is its own transaction over the document as it is then; owners' fields come
  from that read; **a receipt a live collection or claim covers is never voided**
  (`skipped`, run issue `rollup.collected`); creates are batch `create()` (a
  clash falls back to the merge); a quarter closed mid-run is not written into;
  **a failed run says what it wrote** (`written`, `inDoubt`). **S8** is above,
  with issue `cpr.number_conflict`.
- **B1 (A)** — an opening balance with a line on 1120 / 1121 counted PostEx twice
  (the rollup opens it as `PX-OPEN`): a new one is refused (`opening.derived`), a
  stored one is a Needs attention concern naming the journal. **S2 — one live
  collection per receipt, held at the rules:** `ma_claims/{receipt}` = `{doc,
  collection, at, by, releasedAt?}` written inside the collection's transaction
  with a fresh read of each covered receipt; a void releases in the same write.
  Before, the check read outside the transaction, so two tabs could record one
  receipt twice. The rules (`maClaimOk`, `maClClaimedOk`) hold the FIRST covered
  statement's claim; the rest are the page's (they cannot loop — their own
  comment). **The stale net:** the transaction also refuses a receipt whose net,
  status or books side moved since the form opened.
- **S4 (A)** — "changed after collection" also compares the books side, and the
  merge leaves a collected receipt where it is (skipped, with a message to Needs
  attention) rather than move it across the books' start. **S5** — a
  NEGATIVE-net receipt (PostEx taking a return's charge back) is listed and
  tickable; it sat in 1121 for ever. **S7** — one dispute open at a time, the
  opener kept, `disputes[]` append-only (`maDisputePatch`, `maDisputeOk`).
  **Notes 1–3** — a difference inside the tolerance is no line; a new rollup flag
  clears a review; Money in states receipts from before the books apart. **The
  double press** — two presses each awaited the attachment state before the busy
  flag and both wrote; one save a press now, and nothing is offered to collect
  while `ma_collection` is unreadable. `ma_claims` joined the backup, Download
  the books and the QA guards.
- **C — display.** #1 Today clipped its own warning ("incomplete — ma_cpr and
  ma_collection could not be read", 126px past a 390px screen): short words stay
  on a line, the sentence wraps, the layout probe learned a check
  (`data-ma-past-edge`). #3 Run now stays on its page, says an unreadable
  `ma_runs` after three failed polls, reads the run to beat fresh. #4 An
  unreadable `ma_collection` shortens EVERY cash figure and says so; an
  unreadable `ma_cpr` (accruals) marks neither the cash hero nor Blue-Ex. **The
  TCS account (1060) is a wallet** — not in cash in hand, the month's flows or
  Can pay; its own "Held at TCS — not counted" line. Also captions on statement
  fields, a tick that is an 18px box in a 44px cell, a half-read parcel list
  that says so.
- **Not fixed: S6** (decision 11).

### What is verified, and how

- **Node suite — re-run here at `6410744`: 11,007 assertions, all pass.** A clean
  `git archive` of `fa44f86` gave 9,714, with one suite (`qa-access`) failing only
  for want of a `.git`; alone in a throwaway repo it is 39 — **9,753 before M2,
  11,007 after: 1,254 more.** The six new suites, run singly: `ma-couriers` 200,
  `master-accounts-couriers` 189, `master-accounts-couriers-screens` 267,
  `ma-rollup` 239, `postex-core` 142, `master-accounts-m2-review` 120 (1,157).
- **Layout — re-run here:** `SMOKE_LAYOUT_ONLY="master accounts" node
  tests/smoke-layout.js`: 23 fragments (8 new), **118 checks passed**.
  `smoke-app-phone`: the owner's **54 of 54 screens clean in both themes**
  (`ma-in` among them), every other role clean. `smoke-axe` against its baseline:
  exit 0, 22 pairs (the baseline's), none on an `ma-*` page.
- **Rules, in the real emulator — re-run here** (firebase-tools 13, Java, a
  scratch directory; not `*.test.js`, CI runs none): `tests/rules-emulator-ma.js`
  **364 passed, 0 failed** on `85ac93b1…`. The suite reads `firestore.rules` from
  its own tree, so the older-rules runs used a copy of `6410744`'s tree with the
  older file swapped in (a first attempt that only pointed the emulator at it
  proved nothing and was discarded): the same 364 checks **fail 40 on the M1 final
  file (`9d7ec162…`)** — every courier read and every statement, collection, claim
  and dispute write — and **27 on the 29 Sept file (`d56929aa…`)**, all the claims
  (S2) and dispute history (S7). `tests/rules-emulator-qa.js` **632 passed**
  (QA REFUSED on all 19 `ma_*`). `tests/rollup-emulator.js` — the rollup's real
  write path, `firebase-admin` 13.10.0 against the emulator, rules off — **26
  passed**.
- **Reported, not re-run:** fixer C's `smoke-browser` 8/8 and its Chromium
  rendering at 390 and 1280px in both themes; the undo counts above. CI was not
  read for this record.
- **Not verified, not done:** the Console's rules; the Netlify deploy list and
  whether the functions are deployed and scheduled; anything on a real screen;
  the Cloudinary keys (until set, collections are saved "No receipt attached");
  **what a real CPR PDF nets** (§24 asked for one before M2; no CPR PDF or
  courier statement is in the repo — `git ls-files`); **whether PostEx later sends
  the reserve receipt** (`cpr2`); **how long the rollup takes on real data** (a
  15-minute budget; parcels read whole); **production Firestore's ordering of two
  transactions** (the SDK documents its lock as "on all returned documents": the
  receipt and its claim carry the guarantee against a collection recorded during
  a void, not the collections query); a return's final day (taken as
  `orderDeliveryDate`) and the 120-day window are assumptions.
- **Still open:** S6; M5's COD; the two nets; no editor for `settings.couriers`;
  Blue-Ex is not aged from its opening date as §8 planned (no Blue-Ex line in
  `maCourierConcerns` — read from the code); the audit trail shows a rollup row
  as `ma-rollup` where it shows the backup as "Nightly backup" (`_maWho` knows
  only `ma-backup` — read, not run); `QA_ACCESS.md` (`main`'s file, not edited
  here) still counts 15 `ma_*` collections and "91 of the 106" `allow read` lines,
  now 19 and 110.

### Set-up only a human can do

- [ ] **Publish `firestore.rules` `85ac93b1…`** (1,748 lines) **from the repo
  file, not a local copy** — sent 30 Sept (as relayed); **reported done by
  Afnan (about 12:23 UTC, 30 Sept 2026: "done rules updated", file not named),
  not checkable** — that it is this file is a hypothesis, unverified, so the box
  stays unticked. His test: Money in ▸ Couriers loads without "incomplete — …
  could not be read", and **Run now** ends "Done at …".
- [ ] **Read the Netlify deploy list:** was `6410744` (`v269`) built or skipped
  (the 21 Sept credit skip looked like a stale cache)? Are `ma-rollup-background`
  (`45 3 * * *`) and `ma-rollup-now-background` in the function list?
- [ ] **The first rollup:** Run now, or wait for 03:45 UTC; it writes
  `ma_runs/rollup` and an audit row with its own result. Read the PostEx data
  issues and the 1120 check on Today.
- [ ] **Hold one real CPR PDF against a derived receipt's net**, and a TCS, a
  Bykea and a Blue-Ex statement against the form.
- [ ] **The Cloudinary keys** (M1's checklist), so a receipt can be attached.
- [ ] **A first look on a real screen** — nobody has.

## The Sales Team ▸ Marketing (Sept 2026)

Replaces the **Content Tracker 2026** Google Sheet (Master List + monthly
dispatch tabs). Source spec: `GRVY-Marketing-Module-Spec.md` (Ammar's
Downloads, not in the repo). Built **one milestone at a time**, same as the
Mood Boards table round: M1 Creator Database + scoring · M2 Dispatch Log ·
M3 Paid PR approvals · M4 discount codes · M5 reminders + dashboard card ·
M6 reports · M7 migration. **M1–M3 are built, merged and live** (PRs #58,
#59, #60; Daniyal's email fixed in #61) **and their rules were published
on 16 Sept 2026** — see "Firestore rules" below. **M5–M7** are PR #63.
**M4 (discount codes) is the last milestone**, below — the Shopify app's
`write_discounts` / `read_discounts` scopes were added and approved by
Ammar on 16 Sept 2026 (reported in-session; confirm with the Reports
page's "Check Shopify access", which asks Shopify directly).

- **Nav:** "The Sales Team ▸" is a collapsible parent of SUB-AREAS
  (`_salesTeamGroups()` / `_salesTeamNavHTML()` in `js/shared.js`); each
  sub-area supplies its own page list (`mktNavItems()` in
  `js/marketing.js`). **Add a Marketing page there, not in shared.js.**
  Owners see it above Embellishments; on phones it is "The Sales Team ›"
  in the More sheet.
- **The lead account** is `daniyal` → `daniyal@groovy.op` (the account
  Afnan created in Firebase Auth; an earlier cut used a Gmail address, which
  never existed in Auth and was corrected before anyone signed in), role
  `creator_content_ops_lead`, landing on `mkt-creators`. `showPage` scopes
  that role to `mkt-*` pages, `shopify-intel`, `tb-*`, `_CHROME_PAGES` and
  (for Daniyal, on the Creative Hub list since 25 Sept 2026)
  `_CREATIVE_HUB_PAGES` — same
  pattern as the fulfilment redirect. **Inventory Intel is granted only
  because that page never writes**; if it gains a write action, re-scope
  (logged as a follow-up in the Inventory Intelligence change request).
  Being `@groovy.op`, the owner password reset and "Sync accounts" both work
  for him like everyone else.
- **No names in records.** Every "who" field is a Firebase uid, resolved at
  render (`_mktUserName`, via `userProfiles`). Permissions key off role,
  and Paid PR approval off the `canApprovePaidPR` flag.
- **Scoring (`mktScore`)** is the spec's 100-point weighted model. Bands
  live in `scoring_config/current`, edited in-app; `MKT_DEFAULT_SCORING`
  only fills gaps. A creator scores the reach band they are **below**
  (exactly 10,000 followers is 15, not 5). Engagement is rounded to 1e-6
  before the floor compare so 0.0099999 can't slip under a 1% it meets.
  **No tier without its inputs** — followers + avg likes + avg comments
  are required; avg views is optional and scores 0 when absent. A manual
  override keeps its tier through every recalculation, and `tier_formula`
  is stored beside it so the "manual" badge can say what the formula
  gives. Saving the config recalculates everyone in 400-write batches.
- **IG-handle uniqueness is a WRITE-time guarantee.**
  `creator_handles/{handle}` is a lock naming the owning creator, written
  in the same `runTransaction` as the creator. `firestore.rules` refuses a
  creator whose lock does not point back at it (`getAfter`), refuses any
  update to a lock, and only lets a lock be deleted once its creator no
  longer carries that handle. So a rename releases the old lock and two
  simultaneous adds cannot both succeed. Saving a creator therefore needs
  a connection — the form says so rather than queueing.
- **Cities** are the sheet's Lists tab verbatim (`MKT_PK_CITIES`, 94);
  `mktCanonCity` maps case variants and a few unambiguous aliases (pindi).
  **Niche** is an array; the picker offers the seed tags plus every tag in
  use (derived, never stored). Sizes stay free text — the sheet's values
  ("medium/30", "34/XL") don't fit a list.
- `loadMarketingCreators()` cannot reject (allSettled) — a refused read
  renders a card that names the rules republish.
- **Tests:** `tests/marketing.test.js` (band edges, floor, no-basis → null,
  config validation, uniqueness transaction, scoping, and that
  `USER_DEFS` and `isContentOpsLead()` list the same emails) and a
  `smoke-layout` fragment. That fragment caught the table hiding Niche and
  Status off-screen at 420px; rows stack at phone width now.
- **M2 — Dispatch Log (`mkt-dispatches`).** Organic dispatches only; a
  `paid_pr` dispatch is created by a Paid PR approval in M3, and the rule
  refuses a client-created one until then. Every Marketing page now routes
  through ONE line in `renderPage` (`id.startsWith('mkt-')` →
  `mktRenderPage`), so later pages never touch `js/shared.js` for routing.
  - **Status timestamps record the FIRST time a stage is reached**
    (`shipped_at`, `content_received_at`, beside the spec's
    `status_updated_at`). M5's 7/14-day reminders and the Day-7 capture
    count from these, and going back and forward must not reset the clock.
  - **A post link IS content received** — saving one moves the dispatch
    there and the toast says so; otherwise the no-post reminder would keep
    firing on a creator who delivered.
  - **Creator rollups are RECOMPUTED, not incremented**
    (`mktCreatorRollups`), from every dispatch held for that creator, and
    written in the same `writeBatch` as the dispatch. An edited date can
    move first/last in either direction; an increment cannot tell. A batch,
    not a transaction, so it queues offline like the rest of the app.
    Known limit: two people editing the same creator's dispatches at the
    same moment compute from their own copies; the next save re-derives.
  - **`creator_id` and `type` are immutable** once written (rules + the
    payload never re-sends them) — a dispatch moved between creators would
    leave both creators' rollups wrong.
  - **The product picker reads `shopify_products` — the daily 9am-PKT
    catalog sync — never Shopify live**, and always says how old its copy
    is (`shopify_sync_meta/catalog_sync.last_success_at`), warning when it
    is over 30h. It reuses Inventory Intel's copy when that page already
    loaded it. Products are stored by variant id; free text is refused. A
    migrated row may carry `products_note` (the sheet's text) instead.
  - **Day-7** is due 7 days after content received, falling back to shipped
    — and that fallback is marked (`Due *`), per spec §8. The capture form is
    one screen, five fields, one save; views are required.
  - **Dispatches are loaded with the creators** by the same never-rejecting
    loader, all at once. Fine at today's volume; if it grows, page by date
    rather than adding a second loader.
- **M3 — Paid PR Approvals (`mkt-paid-pr`).** A request first, a dispatch
  only once approved.
  - **The hard gate is in `firestore.rules`, not the UI.**
    `isPaidPRApprover()` lists the EMAIL of every account whose `USER_DEFS`
    entry carries `canApprovePaidPR:true` (Ammar); a test fails if the two
    disagree, and the client helper reads only the flag. The lead can
    submit, edit a pending request and log payments — never decide. Both
    halves were checked by breaking them: widening the flag or the email
    list fails seven assertions.
  - **Three kinds of update, each limited to its own fields** with
    `diff().affectedKeys().hasOnly(...)`: edit a pending request
    (`MKT_PR_EDIT_FIELDS`), decide once from pending (approver only), log a
    payment on an approved one (`MKT_PAYMENT_FIELDS`). The JS lists and the
    rules lists are asserted equal. **An approved amount can never change**;
    a decided request is never deleted.
  - **Approval is ONE `writeBatch`:** the decision, the new `paid_pr`
    dispatch (id minted by `mktBuildDecision`, stored on the request as
    `dispatch_id`), and the creator's rollups. The dispatch rule reads the
    request with `getAfter`, so a `paid_pr` dispatch can only exist for a
    request the same batch approved and linked to it — and only the
    approver can write one. A dispatch can't be re-pointed at another
    request afterwards.
  - The new dispatch lands at **Confirmed with no products or date**; the
    lead fills those in from the Dispatch Log, where the normal "add at
    least one product" rule applies on the next save.
  - **`lifetime_pkr_spent` is APPROVED spend** (committed), not what has
    been paid out — payment is logged by hand and "approved ≠ paid" is
    shown on the page and in the stats. The Paid PR rollups are only
    written when the requests actually loaded, so a failed read can't zero
    them.
  - **M4 hooks in at `mktDecidePaidPR`:** the spec creates the discount
    code on approval; that call belongs in the same flow, after the batch.
  - The lead's phone nav has five buttons now (Creators · Dispatches ·
    Paid PR · Reports · Intel) — `#mob-nav`'s own 5-column default.
- **M5 — reminders and the dashboard card.**
  - **Reminders use the existing bell** (`hrm_notifications`), addressed by
    `forUser`. Recipients are resolved when a reminder is raised: the lead
    **by role**, the approver **by the `canApprovePaidPR` flag**
    (`mktLeadUsernames` / `mktApproverUsernames`) — no names, and
    `js/hrm.js` needed no change.
  - Rules: no post 7 days after `shipped_at` → the lead; 14 days → the
    approver too (high priority). **Day-7 capture is only due once there IS
    a post** (a link or Content received) — a first cut reminded people to
    capture numbers for posts that did not exist; the tests caught it.
  - **Raised client-side by whichever Marketing account opens the app**,
    at most once a day per device (`localStorage`), like the HRM
    increment-due check. So nothing fires while nobody opens the app.
    Every reminder has a **deterministic id** (`mkt_sla7_<dispatch>_<user>`
    …) and is only written if absent — several devices make one reminder,
    and a dismissed one is never raised again.
  - It reads only `status=='shipped'` and `performance_captured_at==null`
    dispatches, never the whole log, and caps a run at 60.
  - **The bell prints `title`/`message` into HTML raw** (`_hrmNotifCardHTML`,
    `js/hrm.js`), so handles are escaped before they go in.
  - `mktBootstrap()` runs from `startApp`, **never awaited**, and also loads
    the bell for the lead, who never opens the dashboard that normally does.
  - **Dashboard card** (owners): `renderMarketingDashboardWidget` in
    `renderDashboard` + `_mktPopulateDashboard` in the dashboard dispatch —
    the same two-half pattern as Monitor. Two small queries (this week's
    dispatches, pending Paid PRs). "Discount codes not set up yet" until M4.
- **M6 — Reports (`mkt-reports`).** Monthly PR spend (approved vs paid out,
  by decision month). **Top ROI is Paid PR only and ranks by SPEND until M4
  exists** — it says, on the page, that it is not an ROI ranking yet.
  Best performing (organic) from Day-7 captures, sortable by reach or
  engagement ((likes + comments + saves) ÷ views), never called ROI. Sales
  lift in **two separate lines**: attributed (coded — empty until M4) and
  directional (uncoded — units of the dispatched SKU N days after vs
  before, refunds excluded, labelled as correlation; a window still running
  says "so far").
  - `shopify_line_items` has **no variant id** — only `sku`. Dispatched
    products now store their `sku`, and older ones are matched through the
    catalog (`shopify_products` doc id = variant id). No match → "—", never 0.
  - The line items are read whole (as Inventory Intel already does), once,
    and reused from Inventory Intel when that page loaded them.
- **M7 — the sheet importer (`mkt-import`, button on the Creator
  Database).** In-app, not a service-account script: the `.xlsx` is read in
  the browser with the vendored SheetJS, everything is previewed, and the
  writes go through the same rules and handle-lock transaction as a
  creator added by hand. **Re-running is safe** (existing handles skipped;
  sheet dispatches have fixed ids `dp_mig_<tab>_r<row>`).
  - **The real sheet, dry-run 16 Sept 2026:** 265 Master List rows = 245
    ready + `shadysaidthat` twice (rows 211, 257) + **7 rows with the
    handle typed in the Name column** (5, 101, 123, 149, 174, 245, 248) +
    **11 rows holding only the old tier letter**. With the duplicate and
    the 7 confirmed, **253 creators** — the spec's "254" was a rough count.
    Name-column handles are OFFERED, never applied: each needs a tick, and
    the name is then left empty (that cell held a handle). Cities: `RWP`,
    `abottabad`, `lahore cantt` are mapped; `taxila` is not on the Lists
    tab and is imported as typed, flagged.
  - Monthly tabs (`Sep 2026` … `Dec 2026`) become dispatches: **date and
    status left blank** where the sheet has none, product text kept as
    `products_note`. The three Sep rows match (st4rr.doll, shoaibkhn.t,
    shadysaidthat once its duplicate is resolved); Dec has one row with no
    handle, reported.
  - **A blank status needed a rules change** (`''` is now allowed on
    dispatch create/update) and the UI shows it as "Not recorded", never as
    Confirmed. **That change needs a republish.**
  - The sheet's A/B/C tier column is read (`sheetTier`) and never written.
  - **The first live run looked hung** (reported by Daniyal, screenshot:
    the app's blocking "Saving…" box and nothing else). Verified from code:
    it wrote one `runTransaction` per creator — 245 round trips, each one
    raising the shared write overlay — and the progress log was not in the
    DOM until the run ended. Now creators go in **batches of 100** (creator
    + handle lock together, which the rules check with `getAfter` exactly
    as in the transaction), a refused batch falls back to one transaction
    per creator for that batch only, the run is wrapped in
    `_gvSilentSaveStart/Stop`, and a live progress line shows from the
    first click. Whether that first run finished was not visible from the
    session.
- **M4 — discount codes.** Two server functions, because the Shopify secret
  must stay server-side and because a code record, a redemption count or a
  dispatch's code link must not be forgeable from a browser:
  - `netlify/functions/marketing-discounts.js` (POST, caller's Firebase ID
    token verified on the server; `MARKETING_EMAILS` mirrors `isMarketing()`
    and a test holds them equal). Actions: `status` (asks Shopify
    `currentAppInstallation.accessScopes` — the only way to confirm the
    permission from this side), `create`, `rollup`.
  - `create` **reserves the dispatch first** (`code_lock_at`, 2-minute lock,
    in a transaction) so a double click cannot make two codes; a dispatch
    that already has one returns it. It checks both scopes before calling
    Shopify, retries **only** a taken code (up to 3 suffixes), and on any
    failure releases the lock and writes nothing. On success ONE batch
    writes `discount_codes/{id}`, links the dispatch
    (`has_discount_code`, `discount_code_id`) and increments the creator's
    `lifetime_codes_issued`.
  - The mutation is `discountCodeBasicCreate` with **`context: {all: ALL}`**
    — `customerSelection` is deprecated in the 2026-04 schema — 10% off
    all items, `appliesOncePerCustomer`, no `usageLimit`, ends in 20 days.
    Validated against the Admin GraphQL schema when written (it requires
    both `write_discounts` and `read_discounts`). **The first real code is
    the live test.** Codes are `GRVY-<HANDLE>-<4>`, A–Z/0–9 only.
  - The spec's `shopify_price_rule_id` is `shopify_discount_id` here (the
    GraphQL `DiscountCodeNode` gid) — price rules are the legacy REST model.
  - **Paid PR: approval asks for the code right after the approval batch.**
    The approval stands either way; a failure is toasted with where to
    retry (the dispatch's "Create the Paid PR code"). Organic: the lead's
    button on the dispatch, with a confirm.
  - `firestore.rules`: `discount_codes` is read-only to Marketing and
    unwritable by any client; a dispatch update may not change
    `has_discount_code`, `discount_code_id` or `code_lock_at`.
  - **Redemptions:** `shopify-order-sync.js` (and the backfill) now store
    `discount_codes` on each order, upper-cased. Orders synced before that
    carry none — fine, every code is newer.
    `netlify/functions/marketing-code-rollup.js`, scheduled `30 1 * * *`
    (6:30am PKT) and callable through `rollup`, counts orders per code with
    an `array-contains` query, excludes cancelled and refunded-at-sync
    orders, buckets revenue by **store-local month** (the first 7 chars of
    Shopify's offset timestamp), marks expired codes, and writes creator
    totals — only for creators that still exist (a merge-set would have
    resurrected a deleted one). **Known limit:** the order sync skips an
    order it already has, so a refund made later is not deducted; the page
    says so.
  - Wired into the dashboard card (codes live, PKR redeemed this month),
    the ROI table (real once any Paid PR has a code — Paid PR code revenue
    only), the attributed sales line, and a "Shopify connection" card on
    Reports with **Check Shopify access** and **Recount redemptions now**.
  - `tests/marketing-codes.test.js` runs both functions against an
    in-memory Firestore (replacing `firebase-admin` through
    `Module._load`) and a scripted Shopify. The gate was verified by
    removing it: two assertions fail.
- **Instagram auto-fetch (Sept 2026).** "Fetch from Instagram" on the
  creator form fills followers and average likes / comments / views through
  **Instagram Business Discovery**, called with GRVY's OWN Business account
  (`17841409780333939`, Meta app "API GRVY Ops" `2573791029752857`). An app
  that only serves a business its owner manages gets **Standard Access with
  no App Review**, so there is no "pending review" state anywhere — it is
  live as soon as the env vars are set. Confirmed working by Ammar in Graph
  API Explorer before it was built.
  - `netlify/functions/instagram-business-discovery.js` — POST, the caller's
    ID token is verified and checked against the SAME `MARKETING_EMAILS` the
    discount function exports. `lookup` returns followers and the averages
    over the posts Instagram returns (each average over the posts that carry
    that number — a hidden like count is not a zero); `status` reports the
    token's health. The username is validated (`[a-z0-9._]{1,30}`) before it
    goes into the field expansion.
  - **Not found is a normal answer, not an error.** Business Discovery's one
    failure shape (code 110 / subcode 2207013, "Cannot find User") does not
    tell a Personal account from a typo, so the message says exactly that:
    *"Couldn't find a Business or Creator account with that handle — check
    the spelling, or use manual/screenshot entry if this is a Personal
    account."* Never assert "this is a Personal account".
  - **Fetching never saves.** It fills the inputs; the person reviews and
    presses Save, and any failure leaves the manual fields as they were.
  - **`data_source` on the creator: `'api' | 'manual' | 'screenshot'`**
    (null when there are no numbers). `'api'` is **never taken on the form's
    word** — `mktDataSource` records it only when the saved numbers equal
    the last fetch exactly, so editing a fetched number makes it manual and
    the Source picker follows along. `api_fetched_at` is when. No rules
    change: the `creators` rule does not restrict fields.
  - **The token (`netlify/functions/instagram-token-refresh.js`).**
    `IG_ACCESS_TOKEN` in Netlify is only a SEED. On first use it is
    exchanged (`fb_exchange_token`, with `META_APP_SECRET`) for a long-lived
    user token, and `/me/accounts` is asked for the Page linked to GRVY's
    Instagram — **that Page token is what gets stored**, because Meta's
    long-lived-token doc (read Sept 2026) says Page tokens obtained this way
    have no expiry date, and describes **no way to renew an active 60-day
    user token**. So the spec's "re-exchange before expiry" was replaced by
    "store a token that does not expire, and check it nightly". If no linked
    Page is found, the user token is stored with its expiry.
  - The working token lives in **`integration_secrets/instagram`**, which has
    **no `firestore.rules` match block** — default-deny, so no client can
    read or write it (a test fails if a rule or a catch-all ever appears).
    `shopify_sync_meta/instagram` holds the readable status, never the
    token. Every call carries an `appsecret_proof`. **Changing
    `IG_ACCESS_TOKEN` re-seeds automatically** (the stored doc keeps a
    fingerprint of its seed) — after a redeploy, since Netlify env changes
    only reach functions on the next deploy. A token Meta rejects (code 190)
    is re-seeded once and the lookup retried.
  - **Nightly check** (`15 2 * * *`, 7:15am PKT): `debug_token`, then a bell
    to afnan and ammar if the token is invalid or expires within 14 days
    (high priority at 3), with deterministic ids so it is raised once.
    Reports → **Instagram connection → Check Instagram access** shows the
    same thing on demand.
  - Env vars: **`IG_ACCESS_TOKEN`, `META_APP_SECRET`** required;
    `META_APP_ID` and `IG_BUSINESS_ACCOUNT_ID` optional (default to the ids
    above — ids are public, the secret is not). Unset → "not set up" on the
    form and the Reports card, never a crash. Graph API **`v26.0`** — the
    newest version `graph.facebook.com` recognised when probed.
  - `tests/instagram.test.js` runs both functions against a scripted Graph
    and an in-memory Firestore. **Unverified against the live API**: the
    first real lookup is the test, and so is whether `/me/accounts` returns
    the linked Page for the token Ammar generates (it needs
    `pages_show_list`, which was granted).
- **Fetch all from Instagram** (Creator Database header). The same lookup
  over the whole list, one creator at a time: a Business/Creator account is
  written through `mktApplyIgFetch` → the normal payload builder (so a
  manual tier stays manual and an off-list city survives); a not-found
  account gets **no write at all** — "leave it as is" was the instruction.
  Meta caps calls per hour, so the lookup now returns `usage` (the highest
  percentage in `X-App-Usage` / `X-Business-Use-Case-Usage`) and the run
  **pauses itself at 85%**, stops on any 429, and stops on a 401/403/503
  (a dead connection stops after ONE call, not 244). A rerun skips anyone
  fetched in the last 24 h (`mktIgBulkPlan`), so a paused run resumes.
  Writes are plain `updateDoc`s — the handle does not change, so the lock
  rule is already satisfied. **Whether the hourly allowance covers 244
  lookups in one go is not known from here**; the pause is what makes that
  not matter.
- **A FETCH NEVER CLEARS A NUMBER IT DID NOT GET BACK** (18 Sept 2026 —
  a real data loss, found by Daniyal). Business Discovery omits
  `like_count` for an account that hides its likes (and can send `-1`,
  which `summarize`'s `isNum` filter drops the same way), so `avg_likes`
  comes back **null while followers, comments and views are fine**. Both
  fetch paths wrote that null straight over the stored value:
  `mktApplyIgFetch` (the bulk run) and the form's own fetch, which blanked
  the input. `mktScore` needs avg likes, so the creator lost its score and
  fell into **Unscored / Needs completion** — @aitzazism, the morning after
  the first "Fetch all" run. It reads exactly like someone deleted the
  field, which is why it was reported as one. Editing another field was
  ruled out: the form prefills every tiering input from the stored record.
  **`mktIgMerge(creator, response)` is now the single decision** — a number
  Instagram returns wins, a number it withholds keeps what is stored, and a
  field empty on both sides stays empty and is NAMED. `api_values` carries
  only what the fetch actually supplied, so `mktDataSource` can tell the
  two apart: everything fetched is `'api'`, a record holding a kept number
  beside fetched ones is **`'mixed'`** ("Instagram + kept numbers"), and
  editing a fetched number is still `'manual'`. **The old values are NOT
  recoverable** — nothing versions a Firestore field — so the repair is
  "ask Instagram again": the bulk modal's **Only the incomplete ones**
  (`mktIgBulkPlan(..,{repair:true})`) re-fetches creators whose tiering
  numbers are incomplete, ignoring the 24h skip, and reports how many
  Instagram still will not complete so those can be typed in by hand.
### Marketing — the field round (18 Sept 2026)

Five of the eight findings in Daniyal's report, shipped together because
each is a field or a label rather than a new surface. **Issue 2 (deleting a
dispatch, with Monitor) and Issue 7 (charts on Reports) are deliberately
not here** — the first reverses rollups, the second is a milestone.

- **Sizes are a vocabulary now, and the old free text is READ rather than
  lost.** `top_size`/`bottom_size` were free text, so the live list holds
  `medium/30` and `34/XL`; they are dropdowns (`MKT_TOP_SIZES` XXS–XXL,
  `MKT_BOTTOM_SIZES` XXXS–XXL) plus a **third field, `waist_size`**
  (26–40), because a bottom carries a garment size, a waist, or both and
  squeezing the two into one string is what made the old values
  unreadable. **Nothing is rewritten in place and there is no migration
  pass:** `mktSizeParse` reads the stored string when the form OPENS, so
  saving that creator migrates it, and a value it cannot read is kept and
  shown as **"(as typed)"** — exactly what an off-list city already does.
  A number typed under a TOP fills the waist rather than being dropped on
  save (it is almost always a mis-entered bottom). `mktBuildSizes` is the
  one implementation, so the form, the IG bulk run and the sheet importer
  cannot disagree.
- **`on_hold_stock` — "On Hold — Stock/Production" — is a status OUTSIDE
  the flow, and that is the load-bearing part.** `_mktStatusIdx` compared
  against the position in `MKT_DISPATCH_STATUSES`, and that array now has
  a fifth entry; a status with an index past `shipped` would **stamp
  `shipped_at` on a parcel that never left**. The four stages live in
  their own ordered list (`_MKT_STATUS_FLOW`) and `_mktStatusIdx` answers
  **-1** for anything else, which every comparison in the file already
  reads as "not at this stage yet". Exclusion from Awaiting content, from
  the Day-7 count and from the no-post reminders then falls out by
  construction — none of the three reads a status outside the flow.
  Verified by restoring the old `findIndex` and watching `shipped_at` get
  stamped.
- **A fifth Dispatch Log tile** (On hold) and **"Day-7 capture due" reads
  "Performance snapshot due · 7 days after the post"**, in the tile and in
  the status filter.
- **Niche tags are a managed list.** They were DERIVED only, which is what
  made the "Other tags" box feel broken: the box reads and saves
  correctly — verified in the harness before changing anything, it was
  never a no-op — but a tag typed there lived on that one creator, could
  not be renamed or tidied, and vanished from the picker the moment that
  creator lost it. `marketing_settings/niche_tags` is the curated half;
  `mktNicheLibrary` returns **curated ∪ seed ∪ in use**, so a tag in use
  can never be missing from the picker, including every malformed label
  the sheet import left behind. A tag typed in the box now joins the list
  (best effort, AFTER the save — remembering a tag must never turn a saved
  creator into an error). **Niche tags**, beside Scoring settings, adds,
  renames (merging when the new name already exists), removes, and offers
  a one-click tidy for the `"Blogger"` / `Content Creator"` labels — each
  rewriting every creator carrying the tag, in batches of 400, behind a
  confirm that says how many records it touches. `mktTagRewrite` is pure
  and returns only the creators that actually change.
- **A pending Paid PR can be withdrawn** by an owner or by whoever raised
  it; a decided one never can — the approved amount cannot change (rules)
  and the dispatch, the rollups and any discount code are built on it.
  Editing while pending already worked and is unchanged, which is what
  Ammar confirmed it should be.
- **There is NO client-side `isOwner()`** — it exists only in
  `firestore.rules`; the app reads `session.role`. A `typeof
  isOwner==='function'&&isOwner()` guard therefore fails CLOSED and looks
  right in review. Caught by a test, not by reading.
- **`firestore.rules` CHANGED — it needs a republish:** the new dispatch
  status on create and update, the Paid PR delete clause, and the new
  `marketing_settings` collection.

### Marketing — the drops are a list, and FOUR bugs that were one (18 Sept 2026)

**"Collection sent" offered exactly one option, "Lowkey Heat".** It was
free text with a `<datalist>` DERIVED from whatever collections dispatches
already carried, and that was the only value in the live data — so the
feature looked broken while working exactly as written. It is a `<select>`
over **`MKT_COLLECTIONS`**, the 15 real drops, **newest first and
deliberately NOT alphabetical** — a dispatch is far more likely to be
logged against something recent, so the order IS the affordance. Lowkey
Heat is the most recent; The Owners Drop was the first. **Do not re-sort
it**; a test asserts the literal order and fails on a well-meaning
`.sort()`. Anything already recorded but not on the list (the sheet import
wrote free text) is appended under "Recorded earlier" rather than being
dropped — a value nobody can select again is one that vanishes the next
time that dispatch is saved.

**Four "Missing or insufficient permissions" reports, ONE cause: the rules
were never republished.** Daniyal could not save a dispatch set to On Hold,
could not withdraw his own pending Paid PR, could not remove a niche tag,
and saw the tag panel's yellow "saved tag list could not be read" warning.
No application code was wrong. Verified by diffing the repo's
`firestore.rules` against the version last recorded as published
(`af132bc`), not by reading the symptoms:

| Symptom | Published rule | Repo rule |
|---|---|---|
| On Hold save | `status in ['','confirmed','in_transit','shipped','content_received']` | + `'on_hold_stock'` |
| Withdraw a Paid PR | `allow delete: if isOwner() && status == 'pending'` | + `\|\| (isMarketing() && requested_by_user_id == request.auth.uid)` |
| Remove a niche tag | **no `marketing_settings` match block at all** → default deny | `read, write: if isMarketing()` |

**The yellow warning was the same cause, and that is provable rather than
assumed.** `loadMarketingCreators` puts a MISSING document on the
`fulfilled` branch (`mktNicheTags=[]`, `mktNicheTagsLoaded=true`, no
warning); only a REJECTED read sets `mktNicheTagsLoaded=false`, which is
the only thing that renders that strip. Default-deny on an unpublished
collection is a rejection. **So the falsifiable test is: after a
republish the warning disappears on its own, with no document needing to
be created. If it is still there, it is a second, distinct bug.**

**The lesson, since this is the second round in two days:** a generic
`PERMISSION_DENIED` on a feature that shipped recently is a **deploy**
question before it is a code question. `git log -- firestore.rules`
against the md5 recorded under "Firestore rules" below answers it in one
command, and `tests/invariants.test.js` cannot — it checks the repo file,
and has no way to know what the Console holds.

### Marketing — deleting a dispatch, and Monitor (18 Sept 2026)

Issue 2 of Daniyal's report. A dispatch logged in error had no way out.

- **Only the dispatches nothing else points at can go.**
  `mktDispatchDeleteBlock` refuses a **`paid_pr`** dispatch (its approved
  request carries the `dispatch_id`, and an approved spend is not something
  a delete button should unpick) and any dispatch carrying a **discount
  code** (`discount_codes/{id}` names it and the nightly rollup counts
  against it). **Both are in `firestore.rules` as well**, so the UI guard is
  not the boundary: delete is `isMarketing() && type == 'organic' &&
  has_discount_code == false && discount_code_id == null`. That **narrows**
  what an owner could do — the old rule was a bare `isOwner()` — and widens
  who can do the safe case, which is the point.
- **A codes read that FAILED refuses the delete rather than guessing**, the
  same rule `mktCreatorDeleteBlock` already follows.
- **The rollups are RECOMPUTED from what is left, never decremented** —
  `mktCreatorRollups` over the remaining dispatches, in the same
  `writeBatch` as the delete. An edited date can move first/last in either
  direction and a decrement cannot tell. Verified by replacing it with a
  decrement and watching the test fail.

**Monitor — and the bug found while wiring it in.** The watched PERSON was
a single name (`_MONITOR_WATCH_USER`), which CLAUDE.md flagged as assumed
by "several places" — seven of them. It is **`_MONITOR_WATCH_USERS`, a
list** now (`mustafa`, `daniyal`), and every site goes through one
predicate, `_monitorIsWatched(row)`, which needs BOTH a watched person and
a watched action. Matching is by **username** (`a.u`, which `logActivity`
writes since Profiles) falling back to the display name for older rows.
Watched Marketing actions are **removals only** — Dispatch deleted, Creator
deleted, Paid PR request withdrawn, Niche tag removed. Logging and editing
a dispatch are ordinary daily work and are deliberately not watched.

- **Every Marketing verb had been landing in the generic "Process"
  bucket since M2.** CLAUDE.md asks for a sanity-check whenever a new
  `logActivity` verb appears and it was never run for this module:
  `Dispatch logged`, `Dispatch updated`, `Creator updated`, `Profile
  updated`, `Creator scoring updated`, `Creators fetched from Instagram`,
  `Dispatch performance captured` and `Niche tags tidied` all fell through
  to ⚙️. `create` gained `logged|captured`, `edit` gained
  `updated|fetched|tidied`. **Checked the documented way** — all 126
  `logActivity` strings in `js/*.js` categorised before and after:
  **exactly 8 moved, every one of them out of `other`**, and genuinely
  process-shaped actions (`Stage done`, `QC disposition`) stay in the
  fallback. Asserted both ways.
- **A withdrawal is a removal, not a payment.** "Paid PR request withdrawn"
  contains the word *Paid*, so it landed under Approve / Money — which is
  checked before Edit but after Delete. `/withdraw/` is in the Delete
  matcher now, where a person looking for what was removed will find it.
- `tests/monitor.test.js` is new (49 assertions) — there was no suite for
  `js/activity.js` at all.

### Marketing — charts on Reports (18 Sept 2026)

Issue 7, built rather than estimated. Hand-drawn inline SVG: no charting
library, the same zero-new-deps line the board canvas and the formula
parser hold. Three rules the drawing code follows, each of which has cost
this app something already:

- **Every colour is a CSS variable.** A chart is chrome, and a literal hex
  is the dark-mode bug this codebase keeps shipping (the SLA panels, the
  priority chip, `.cut-table th`). Asserted: no `#rrggbb` reaches the SVG.
- **It scales by `viewBox` + `width:100%`**, so the phone gets the same
  chart rather than a clipped one.
- **Labels are escaped** — a creator's name is drawn into `<text>`, which
  is as interpolatable as a `<div>`. And there is **no `<title>` element
  anywhere**: it carries text but has no box, which the layout probe reads
  as invisible text. `role="img"` + `aria-label` instead.

**A chart never REPLACES its table** — reading a figure off a bar is
guesswork and these are numbers people are paid against. Asserted per
section.

- `mktChartMax` rounds the axis UP to something round, and **is never 0**,
  so an all-zero chart still draws its baseline instead of dividing by
  zero. `mktChartTick` shortens to `45k`/`1.2m`; `mktChartClip` cuts a long
  handle rather than letting it overrun.
- Two new cards: **Dispatch activity** (organic vs Paid PR per month, 6/12/24)
  and **Creator tiers**. `mktDispatchActivity` **emits a month with nothing
  in it** — a gap in the log has to read as a gap, which is the whole point
  of a time axis — and says how many dispatches carry no date and cannot be
  placed at all. `mktTierDistribution` counts an unknown tier as Unscored
  rather than dropping it.
- Charts were added above the three existing tables: spend (approved vs paid
  out, **oldest first — a time axis reads left to right**, while the table
  below stays newest first), ROI (the ratio when codes exist, spend when
  they do not, matching what the warning above it already says), and the
  organic ranking, which **follows the sort toggle**.
- **A refused read never renders as an empty chart** — the Store lesson.

### The charts were SVG, and SVG text does not obey a font size (18 Sept 2026)

Ammar, with a screenshot: *"Reports text/font sizes are too big."* The
first guess would be the type scale. It was not — **the charts were drawn
into one `<svg viewBox="0 0 720 H">` sized `width:100%`, and text inside a
scaled SVG is in VIEWBOX units, not CSS pixels**, so the browser
multiplies it by whatever the scale happens to be.

**MEASURED in headless Chromium rather than reasoned about:** at a 1900px
window the SVG rendered **1818px against the 720 viewBox — a 2.53× scale**,
so a 13px label declared 13px and occupied a 43px box, painting at ~33px.
That is the screenshot. **At 420px the scale is 0.61× and the same label
painted at ~8px** — the identical bug erring small, which is why nobody
had reported it. The approach was wrong at both ends, not too large at one.

So the charts are **HTML now**: bars, gridlines and the track are geometry
and stay proportional (percentages in ordinary boxes), and **every piece
of text is real HTML at the app's own font sizes**. Re-measured after: a
12px tick occupies a 12px box at 1900px and at 420px. That also puts chart
text under the Comfortable scale and the dark-mode tokens like everything
else, instead of in a coordinate space of its own.

- **`tests/invariants.test.js` holds the rule** — neither chart builder may
  emit `<svg>`, a `viewBox` or a `<text>` element, and the series palette
  must be all CSS variables. Verified by turning one `<span>` back into a
  `<text>`: it fails by name. **A future chart must draw its text in
  HTML**; a bar or a sparkline in SVG is fine, a label is not.
- The `title` ATTRIBUTE on a bar is a tooltip and has no box — distinct
  from the `<title>` ELEMENT the layout probe reads as invisible text, and
  the test now says which it is checking.

**The same screenshot carried a second bug: the y-axis read 0, 1, 2, 2, 3.**
Five gridlines over a max of 3 put the ticks at 0.75 steps and the
formatter rounded them into a repeat. **A repeated axis label is worse
than a wrong one** — it reads as a rendering fault and makes every bar
beside it suspect. `mktChartScale` picks the STEP first from a
1/2/2.5/5/10 ladder and derives the top from it, so a fraction cannot
appear; `integer:true` keeps it whole for a chart that counts things,
because half a dispatch is not a quantity.

**`mktAxisScale` then makes it unconditional, and that is the part worth
keeping.** It checks the caller's own FORMATTER for a collision and drops
to a whole-number scale if it finds one — because it is the formatter that
loses the precision, not the step. A chart that forgets `integer:true`
still cannot render a duplicate, while the ROI chart's `1.25×` formatter
keeps its decimals. Asserted across eleven maxima.

**The layout probe named SVG findings as `[object SVGAnimatedString]`.**
`className` on an SVG element is an `SVGAnimatedString`; CLAUDE.md records
this being fixed once for the "covering element" report, and every OTHER
finding still stringified it that way — so a chart label or an icon
reported as an unidentifiable blob. One `clsOf()` helper now, used by all
six sites. Found by deliberately breaking a chart colour and reading what
came back; the same break now names `mkt-chart-lab`.

- **Scoring settings are Ammar's alone** (17 Sept 2026). A third
  per-account flag, `canEditScoring` on Ammar's `USER_DEFS` entry
  (`canEditScoring()` in `js/auth.js`), mirrored by EMAIL in
  `firestore.rules` `isScoringAdmin()`; a test fails if the two disagree.
  `scoring_config` stays READABLE to all of Marketing — every creator save
  is scored with those bands — but only the admin may write it. The button
  is hidden from everyone else (the other owner included), and opening or
  saving it anyway is refused client-side too. Rules published 17 Sept 2026.
- **Deleting a creator** (owners and the Content Ops lead — the rules
  allow `creators` delete for `isMarketing()`; widened from owners-only at
  Ammar's request so Daniyal can clean up the list). One
  batch deletes the creator and its handle lock (the lock rule releases it
  once the creator no longer exists; a lock naming ANOTHER creator is never
  touched). **A creator with any dispatch or Paid PR is refused** —
  `mktCreatorDeleteBlock` — because those records, their rollups and codes
  would point at nothing; "Do not use" is how to retire one. If either list
  failed to load, the delete is refused rather than guessed.
- **`tests/smoke-layout.js` now runs Chrome in a bounded pool** (default
  min(8, CPUs), `SMOKE_LAYOUT_CONCURRENCY` to override). With 14 fragments
  it launched 84 Chromes at once and most timed out on a Windows machine,
  reporting "the probe never ran" — the runner failing, not a layout.
- **Known for M7:** the sheet's Master List has **265** non-empty rows, not
  the spec's 254 — reconcile before import. The Sep 2026 tab's three rows
  (st4rr.doll and shoaibkhn.t — Lowkey Heat; shadysaidthat — Live In
  Pants) migrate into `dispatches` with date and status left blank.

## The Board (Sept 2026) — `js/theboard.js`

One shared calendar and one set of task lists over **one object: an item**.
An item with a date is on the calendar, an item in a list is a to-do, an item
can be both. Top-level sidebar tab, first, audience `BOARD_USERS`. The build
spec is Ammar's `the-board-build-prompt.md`; **`BOARD.md` at the repo root is
the living record** — read it before touching this module.

- **EVERYTHING IS PREFIXED `tb`, AND THAT IS LOAD-BEARING.** `js/boards.js`
  (Mood Boards) owns page ids `boards`/`boards-all`/`board-canvas`, **259
  `.board-*` CSS classes** and ~400 `boards*`/`_boards*` globals. These are
  classic scripts in ONE lexical scope, so a top-level `const BOARD_NAME` or
  a `.board-item` class here is a parse error that takes the whole app down,
  not a naming nuisance. `tb` for JS, `.tb-` for CSS, `tb-` for page ids.
  Firestore names do not share JS scope, so the collections keep `board_`.
  A test asserts no `board-` class can reach the DOM from this file.
- **The audience is mirrored, not shared.** `BOARD_USERS`/`BOARD_OWNERS` by
  username in `js/auth.js`; `isBoardUser()`/`isBoardOwner()` by EMAIL in
  `firestore.rules`. `tests/theboard.test.js` fails if they name different
  people — the `isPaidPRApprover()` guard, again. **Board owner is not the
  app's `owner` role**: it is who may override a lock.
- **`designer` is a new role (Saim).** No existing role fit: `manager` hands
  over POs, gate passes, HRM and the store; `viewer` gives a fixed 3-button
  phone nav with no More sheet. Scoped in `showPage` to `tb-*` + the chrome
  pages. **Daniyal's scope gained `tb-*`** — without that edit to
  `js/shared.js` he could not reach the tab at all, since his role rewrites
  every non-`mkt-` id.
- **Daniyal's phone nav changed**: `#mob-nav` is a fixed 5-column grid, so
  Inventory Intel moved behind a More sheet rather than becoming a squeezed
  sixth button. Nothing he could reach before is unreachable.
- **No `board_notifications` collection.** The Board writes into
  `hrm_notifications` like Marketing does, so it inherits the bell and the
  badge for free. **The price: `_hrmNotifCardHTML` prints `title`/`message`
  into HTML RAW**, so every row goes through `tbNotifPayload()`, which
  escapes both. Nothing may bypass it; a test holds it.
- **`_tbDay`, never `toISOString().slice(0,10)`.** The latter is UTC and in
  PKT names the PREVIOUS day between midnight and 5am. Three live call sites
  in this repo already have that bug (listed in `BOARD.md`, deliberately not
  fixed here).
- **`firebase.json` + `.firebaserc` are new**, scoped to firestore rules and
  indexes ONLY — no `hosting` key (a deploy must not touch Netlify) and no
  `database` key (RTDB rules still go in by hand). `firebase deploy --only
  firestore` replaces the Console paste.

**THE CALENDAR SHIPPED FROZEN (fixed 26 Sept 2026, session 2).**
`window.tbCalFilter=` (a dropdown handler) replaced the top-level `function
tbCalFilter` (the pure filter) — in a browser those are ONE binding — so the
calendar recursed into its own repaint for ~17s and left a 1.36 MB junk
filter in localStorage. 5,466 assertions were green: the harness gives each
script its own `window`. **Never name a `window.X=` handler after a top-level
function** (invariant now), and **run `node tests/smoke-board.js` before
pushing any Board change** — it drives every page and calendar control in
real Chromium against an in-memory Firestore. The session-2 run is logged in
`BOARD-LOG.md`.

**Phase 2 (items, lists, Dashboard cards 1-8, the drawer, the seed).**

- **Every DECISION is a pure function and the writers are thin wrappers.**
  `tbParseQuickAdd`, `tbNewItem`, `tbItemPatch`, `tbVisibilityFor`,
  `tbHandoverPlan`, `tbDonePlan` and the eight Dashboard selectors take
  arguments and return values, so a rule about what an item becomes is
  assertable with no database and exists exactly once.
- **An item and its activity row land in ONE batch.** Counting the writes
  does NOT prove this -- splitting the log into its own `setDoc` still
  totals two. The assertion has to read the batch's CONTENTS, which was
  found by breaking it and watching the first version pass.
- **`0 || 9` is 9.** `_TB_KIND_ORDER.gate` is 0, so a `||` default sorted
  gates LAST -- the exact opposite of "gates first". Caught by a test, not
  by reading. Any rank table with a zero needs `!= null`, not `||`.
- **`js/shared.js` defines its own `showToast`, which SHADOWS the harness
  stub.** So `state.toasts` is ALWAYS EMPTY in any suite that loads
  shared.js, and a test asserting on it passes vacuously. Capture toasts
  explicitly after load instead (`tests/theboard.test.js`, `catchToasts`).
  This affects every suite in the repo that loads shared.js, not just this
  one.
- **Row titles WRAP to two lines rather than ellipsizing.** The class
  matches the layout probe's `[class*="-row"]` selector, and an ellipsized
  element ALWAYS reports `scrollWidth > clientWidth` -- so it failed at
  1280px and 420px. Renaming the class to dodge the check would have hidden
  every real overflow in those rows too. Wrapping is also better here: the
  seeded milestone titles are long enough that one truncated line is a task
  you cannot read. MEASURED both ways -- a title that cannot shrink
  overflows the row by 361px at 420px and the probe names it.
- **`min-width:0` stopped being load-bearing once the title wrapped**, and
  the comment claiming it was got corrected rather than left standing.
  Checked by removing it.
- **The seed is idempotent by DETERMINISTIC ID** (`tb_<lane>_<slug>`), not
  by "does a row with this title exist", and **a re-run writes no item that
  exists** (26 Sept 2026 -- it used to merge every field but a keep-list
  back, which emptied attachments and made private items shared again). It
  keeps a record in `board_config/seed`, so a milestone deleted since is not
  brought back and a person taken off the list is not put back; the only
  addition to an existing item is someone left off for want of a login, by
  `arrayUnion`. `BOARD.md` "Running the seed" has the full rule. The body is
  `scripts/board-seed-plan.js`, which never requires `firebase-admin` --
  CI installs nothing, so the callers hand it the Admin handles.

**Phase 3 (the calendar: month + week, filters, drag).** Rows-by-person
and the unscheduled tray are phase 5.

- **The drag captures the pointer LAZILY, past a 4px threshold**, and the
  tracking is on the DOCUMENT. This is `js/boards.js`'s hardest-won lesson
  applied from the start rather than after the sixth report: an eager
  `setPointerCapture` RETARGETS the following `click` to the capturing
  element. Verified by removing the threshold -- the click stops opening
  the drawer, which is the bug in its purest form.
- **`tbMovePlan` is the lock model in ONE pure function** -- refused with a
  reason, or a patch plus history plus who to tell -- so the drag, the
  keyboard and anything added later cannot disagree about what a move is.
  A board owner's override is written into the ACTIVITY PAYLOAD, not only
  said in a toast.
- **The drag is DRIVEN in the test, not grepped.** `_tbDayFromPoint` was
  extracted precisely so it is the one part a test replaces; everything
  else -- threshold, capture, document tracking, drop, batch, notify --
  runs for real. Asserting the helpers would have proved only the helpers.
- **The layout probe caught a real dark-mode bug on its first run**: the
  padlock on a GATE pill inherited `var(--text)` while the pill is
  `var(--dark)`, which INVERTS -- 1.11:1 in light, 1.01:1 in dark. The rule
  this app keeps relearning: **anything painted on `--dark` takes its ink
  from `--on-dark`**. It also caught a marker label crushed to **1px** in a
  ~50px phone day square.
- **What that fragment does NOT hold, checked by breaking it:** the pill
  title's `min-width:0`. The pill clips its own content, so an overlong
  title ellipsizes rather than overflowing anything measurable. The INK is
  guarded (a gate title painted in its own chip colour fails at 1:1 and
  names it); the flex geometry is not, and the CSS comment says so rather
  than leaving the claim standing. **Phase 2's row title had the same
  shape** -- two rounds running, `min-width:0` turned out not to be what
  the probe was watching.
- **The week starts Monday** (Pakistan's weekend is Sat/Sun), and **a month
  gets the rows it needs** rather than a fixed six. A spill day from a
  neighbouring month is dimmed but still a drop target, or the 1st of next
  month is unreachable from the month you are on.
- **"Me" is what you are ON, not what you own**, and "everyone" still never
  shows someone else's PRIVATE item -- the rules would refuse it and the UI
  has to agree.
- A test regex of `/class="tb-day/` counted **35 for 7 cells**: `tb-dayhead`,
  `tb-daynum`, `tb-daymark`, `tb-dayadd` and `tb-daylist` all start with it.
  **Any class-prefix count needs a boundary.**

**Phase 4 (comments, mentions, files, the inbox).** No `firestore.rules`
change and no new index — the `comments` rule and the `user_profiles`
self-update rule shipped in phase 1, `hrm_notifications` is already
`signedIn()`, and the inbox is one `where('forUser','==',u)` sorted in
memory.

- **THE XSS BOUNDARY HERE IS "ESCAPE FIRST, FORMAT SECOND", and it is a
  DIFFERENT boundary from js/boards.js's.** Mood Boards stores real HTML
  and must rebuild it against a tag allow-list; The Board stores PLAIN
  TEXT, so once `_tbEsc` has run every tag in the output is one
  `tbRenderBody` wrote and there is nothing left to sanitise. A DOMParser
  pass here would be theatre — and untestable, since the harness's
  DOMParser is a tag-soup stub. **The scheme check IS the autolink
  regex**: only `https?://` can match, so `javascript:` never reaches an
  href.
- **Ammar's popover rule, not in the spec: ENTER SELECTS ONLY when
  exactly one candidate matches or a row has been arrowed to.**
  `tbMentionAccepts` is the whole rule. A popover that swallows Enter on
  an ambiguous list picks somebody at random on the author's behalf.
- **mentionStats is written `set` with `{merge:true}`, never `update`** —
  a profile row that does not exist yet would fail an `updateDoc` and take
  the comment down with it; carrying `uid` satisfies the create clause as
  well as the update one.
- **Typing does NOT repaint.** One repaint rebuilds `main-content`
  wholesale, which would destroy the textarea the caret is in. The
  popover repaints ONE element — Notes' block-editor reason.
- **Files are CLOUDINARY and the thumbnail is a DELIVERY TRANSFORM**, not
  the spec's client-side 320px JPEG: no second artefact to keep in step,
  nothing to migrate, the original never rewritten. 25 MB is OUR cap,
  checked before sending; Cloudinary's own refusal is passed through with
  a line saying that number lives in the account's plan.
- **The inbox is LIVE from a `startApp` wrap**, so the badge moves on
  every page. **No listener is a fallback, not a hang**: with no
  `onSnapshot` bridged it does one `getDocs`, and a refused read renders
  an error rather than "nothing in your inbox".
- **A live bug this phase exposed:** `tbHandoverPlan` interpolated the raw
  UID into its comment body, so the thread would have read "handed over to
  @u-dani". Nothing could read that thread until phase 4.
- **`js/shared.js` declares `currentPage` at top level, so it CLOBBERS
  the harness's `currentPage` option** — exactly as it clobbers `session`.
  A toast assertion passed VACUOUSLY because of it; found by breaking the
  seeding and watching the suite stay green. Set it with `app.run` after
  load. **This affects every suite in the repo that loads shared.js.**
- **The working tree is CRLF on Windows**, so a multi-line search string
  written with a bare `\n` matches nothing — a break then reports a clean
  pass, which reads exactly like "the assertion has no teeth". Normalise,
  or break one line at a time.

**Phase 5 (the phone, the keyboard, search, cards 10-12).** No
`firestore.rules` change, no new index, and **no cross-track file touched
at all** -- `js/theboard.js`, `css/main.css` and the tests.

- **Spec s11's bands replaced the module's own**: >=1024 desktop, 640-1023
  tablet, <640 phone (it shipped on 900/600). `_tbIsPhone()` moved with
  them -- a 620px screen was being given the month grid it cannot render.
- **The rail does NOT collapse to icons in the tablet band.** s11 asks for
  icons; this module has none on purpose, the Creative Hub precedent. It
  docks horizontally instead, which is what the phone already did.
- **A search is a MODE, not a fifth page**, and it says what it covers:
  comments are searched only in threads opened this session, because a
  thread is a subcollection read when a drawer opens. A filter that
  implied otherwise would be a filter that lies.
- **`tbShortcutFor` is the whole keyboard in one pure function** -- it
  names an action and never performs one. **Escape is read BEFORE the
  editable bail**, the rule js/boards.js had to learn twice. The document
  listener is registered once at load and bails unless a `tb-` page is up.
- **A RENDER FUNCTION MUST NOT WRITE.** `boardLastSeenAt` started inside
  `_tbDashboard`, which turned every repaint into a round trip -- the
  create test caught it going from two documents to three. It writes from
  `tbRenderPage` on page OPEN now.
- **Dashboard card 11 is DERIVED from the items in memory** (created,
  moved, done) rather than from a collection-group query over every
  item's activity subcollection: both of the spec's own examples fall out
  of fields the item already carries, so it needs no new read, no index
  and no rules change. What it cannot show is written down rather than
  implied.
- **A card with nothing to SAY is hidden**, or five team rows reading
  "0 open" would suppress the empty state entirely.
- **ONE predicate serves the calendar grid and the unscheduled tray.** A
  second copy is how a chip comes to say 4 while the tray draws 3.
- **On a phone a pill is HELD, not dragged** (s11). A 4px threshold aimed
  at a ~50px day square is not a gesture a thumb can land.
- **AMMAR IS A BOARD OWNER AND OVERRIDES ANY LOCK.** The first draft of a
  lock test got this wrong in phases 3, 4 AND 5. If the assertion is about
  a refusal, the person in it is Daniyal.

**A layout fragment that proved nothing, and how it showed up.** The first
`smoke-layout` fragment for the rail PASSED two deliberate breaks — covering
the rail, and painting the active tab's ink the same colour as its chip.
Neither is a probe limitation: **`js/auth.js` declares `session` at top
level, so it CLOBBERS the harness's `session` option when it loads**, the
gate failed closed and the fragment was measuring the module's "you do not
have access" div — one element, no buttons, no contrast problem. Set
`session` with `app.run(...)` AFTER `loadApp`, the way every logic suite
does. With that fixed the ink break fails at 1:1 naming `tb-railbtn on`.
**This is the "fragment measuring itself" trap in a new place — confirm a
break actually bites before believing a fragment has teeth.**
## Fabric issue → Embellishment job (21 Sept 2026)

Afnan: *"after issue registry the data is landed in embellishment department
> embalishment job … connected to what po is cut then what fabric was picked
and what is the article code and what is the article name and what sizes
were cut per size."*

**Half of this already existed, and the half that existed was wrong.**
`autoCreateEmbJob` had created a `printing_jobs` record since the day the
module shipped — but it fired from `markCuttingDone`, not from the fabric
issue, and **it sized every job off what was ORDERED**:

```js
autoCreateEmbJob({...po, cutQty:{...cutState.actualQty}, bundleIds})  // caller
totalQty: po.qty||0, sizeBreakdown: po.sizes||{}                      // payload
```

The caller passed the real cut in and the payload **threw it away**. Every
auto-created job on the live site is sized off the order, not the cut. It
carried no fabric information at all.

**THE CHAIN NOW.** Fabric issued → job created (fabric + PLANNED cut) →
cutting done → the SAME job topped up (ACTUAL cut).

- **`embOnFabricIssued(po,gp)` / `embOnCuttingDone(po,actualSizes)` are the
  two entry points**, both funnelling into `_embUpsertJob`. All the logic is
  in `js/embellishments.js`; `js/fabric.js` and `js/pos.js` gained **one
  `typeof`-guarded call each and nothing else** — the Pattern Hub's rule for
  `js/pos.js`, so a build without the module behaves exactly as before.
  `embellishments.js` loads at 6 and `fabric.js` at 11, so the bare name
  resolves.
- **PLANNED AND ACTUAL NEVER OVERWRITE EACH OTHER.** `plannedSizes`/
  `plannedTotal` come from the issue, `actualSizes`/`actualTotal` from
  cutting. A floor that cut 180 against a planned 200 is something printing
  has to SEE, not a number to quietly replace. `totalQty`/`sizeBreakdown`
  remain the DISPLAY pair — actual once known, else the plan — so **all four
  existing readers of `sizeBreakdown` needed no change**.
- **Not named `cutQty`/`cutSizes` on purpose**: `cutQty` on the PO document
  is an OBJECT of per-size counts, and the same name meaning a NUMBER on a
  different collection is the sort of collision this file keeps recording.
- **SIZES ARE WHATEVER WAS CUT, and that cost nothing.** The issue records
  free-text sizes as an ARRAY (`[{size:'30',qty:80}]`); the job stores an
  OBJECT keyed by those labels. **Checked before designing anything: all
  four readers iterate the object's own keys** (`Object.entries`/
  `Object.keys`), so a denim job reads `30: 80 · 32: 120` with no reader
  touched. Only `parseSizeBreakdown` — which serves the MANUAL form's
  `"10:20:30"` string — is still XS–2XL, and that is correct for a field
  whose format is positional.
- **ONE JOB PER PO; a second issue ADDS to the plan.** A PO can be issued
  fabric twice (a second colour, a top-up). `fabricIssues` is an array, the
  planned sizes merge, and **the same gate pass arriving twice changes
  nothing** (deduped on `gpId`) — a retry must not double the plan.
- **A PO with no embellishment gets nothing, silently.** The gate is
  `po.embellishment.required`, set at PO creation; a plain garment never
  reaches the printing floor.
- **A top-up never moves `currentStage`.** Cutting finishing must not reset
  a job already in bulk printing; the stage-history line is appended at
  whatever stage the job is on.
- **Fabric carried:** per-fabric type/gsm/colour/rolls/qty (the issue's own
  `fabrics` array, so a 2-tone issue keeps its split), the rib, the gate-pass
  id, the date and the **cut master**.

**TWO BEHAVIOUR CHANGES, named rather than buried.**

1. **The PP-sample SLA clock starts EARLIER** — `addSLAEvent(...'pp_sample')`
   fires on creation, which is now the fabric issue rather than cutting
   completion. That is the point (printing prepares while cutting runs), but
   SLA numbers will shift and **Ammar's track owns that file**.
2. **Jobs already in Firestore keep their ordered-qty numbers.** Nothing
   migrates — a correction pass over existing jobs is a separate, reviewable
   job, not something to fold in silently.

**KNOWN LIMIT, stated because it would otherwise read as a promise.** The
issue screen takes free-text sizes, but `markCuttingDone` is driven by
`PO_FLOW_SIZES`, which is **alpha-only** (CLAUDE.md, Pattern Hub: "four size
axes exist and `PO_FLOW_SIZES` covers only one — deliberately left alone").
So a denim PO's job carries waist sizes in its PLAN and alpha sizes in its
ACTUAL, until that constant is widened. The display pair prefers actual, so
**a waist-sized PO shows waist until cutting-done and alpha after it.**
Widening `PO_FLOW_SIZES` is the fix and it is a cross-track change.

`tests/embellishment-jobs.test.js` (43 assertions) **drives the entry
points**, never the helpers — the `_boardsColumnForCard` lesson. Verified by
reverting each piece: restoring `po.qty`/`po.sizes` fails 3 by name,
overwriting the plan fails 2, dropping the gate-pass dedupe fails 4, making
a second issue mint a second job fails 4, and removing the embellishment
gate fails 2. **What that suite CANNOT prove is that anybody calls those
entry points**, so `tests/invariants.test.js` holds the two call sites
(present, `typeof`-guarded, handing over the payload and the actual cut) —
verified by deleting the fabric.js site (4 fail) and the pos.js guard (1).

**Nobody has issued fabric on a real screen** — the sandbox cannot sign in [29 Sept: a headless QA session can sign in and render — see "Sandbox limits"].

## Pattern Hub (Sept 2026)

Physical sewing patterns — heavy craft paper, traced by Hassan and Alam,
hung on **10 hooks × 5 slots** — get a digital twin: a code, a home, a
measurement grid, and the articles that use them. **`PATTERN_HUB_PLAN.md` is
the design, agreed across three question rounds with Afnan; read it before
touching this module.** Built one milestone at a time, like Marketing.

The decision everything hangs off: **a pattern is a BLOCK, and many article
codes point at one pattern** (14 Live In Pants colourways = one pattern),
with **one hook slot holding all sizes of one block bundled**. Blocks are
created by hand — name-clustering says 251 but 133 articles are prints on a
handful of blank bodies, so the real count (60–130) is the pattern master's
call, and the app only ever *suggests*.

**M7 (shipped — the last milestone): the Dashboard card.** Assigned /
measured / labelled / open notices, for pattern admins only, above the PO
stats. Uzaib is a `viewer` and never sees the dashboard; his route to the
notices is still the Me-page button.

- **The two-half widget pattern, both halves or neither.**
  `renderPatternDashboardWidget()` is a SYNCHRONOUS placeholder returned by
  `renderDashboard()` (`js/embellishments.js`, behind a `typeof` guard
  because `patterns.js` loads LAST); `_ptnPopulateDashboard()` is a fifth
  `setTimeout` on the `id==='dashboard'` dispatch in `js/shared.js`. A
  placeholder nobody populates sits on "Loading…" forever and no logic
  suite would see it, so `tests/patterns.test.js` asserts BOTH halves are
  present — verified by deleting each.
- **A refused read NAMES the collection; it never reads as 0%.** Coverage
  over an empty `tacArticles` is "0 of 0", which is exactly what a denied
  `articles` read would otherwise paint — the Store lesson. An empty
  registry says "not seeded yet" instead, and a `pattern_notices`-only
  failure degrades: the tiles still render, the notice count shows **—**
  rather than a 0 that would read as "all clear".
- **Retry clears the `_ptnPoEnsure` "already loaded" flags** before
  re-running, or the button would return the same failed state instantly
  and do nothing — the dead-button shape this codebase keeps producing.
- **"Measured" is every POM row × every size**, and **"labelled" is every
  size carrying a CURRENT sticker**, so a block whose grid changed after
  printing counts as unlabelled again. `ptnBlockProgress()` reuses
  `_ptnGridFilled` and `_ptnLabelStatus` rather than re-deciding either.
- No `firestore.rules` change; the card reads nothing the module did not
  already read.

**Two things Afnan reported after M7, both real, both fixed.**

- **Every size header sat over the WRONG column.** The grid's `<th>` was
  `text-align:right` inside a column stretched by `min-width:100%`, while
  the 64px input sat at the column's LEFT edge — so each label drifted
  **135px right, MEASURED in headless Chromium** (0 after), and the XS
  label landed over the S box. The point-of-measure column takes
  `width:100%` now, so the size columns shrink to their box, and header
  and cell are both `text-align:center`. `smoke-layout` has a fragment for
  the grid, but **it does not measure alignment** — only zero-width text,
  overflow, hit-testing and contrast; the markup rule is asserted in
  `tests/patterns.test.js`, and the 135px→0 is a one-off measurement.
- **A PTN number was spent even when nothing was created.** Reported as
  *"i did not save any … pattern number keeps on bumping up"*. The mint
  called `getNextId('patterns')` — **its own transaction, which commits on
  its own** — and only then wrote the block in a second one. Every failure
  of the second burned a number: a refused write, or simply no connection,
  since **a `runTransaction` cannot use the offline cache and fails
  outright** (the Mood Boards Stage 6 lesson, in a new place). The counter
  read and the block write are now ONE transaction, so a write that does
  not land never moves the counter — **verified by restoring the old shape
  and watching the assertion fail (`got 42, expected 41`)**. The number is
  also floored at the highest `PTN-####` already loaded
  (`_ptnCodeFloor()`, retired blocks included), the same guard the article
  counter carries, so a counter left behind by a hand edit can never
  re-mint a code a block already holds. **Opening and closing the form
  never touched the counter — only Create did**, so a report of the number
  moving means a Create was pressed and its write was refused; that now
  costs nothing.

**M6 (shipped): PO integration — the pattern code and its hook, on the PO.**
Creating or editing a PO stamps `patternId` / `patternCode` / `patternHook`
from the article's block; the detail page, the **cutting screen** and the
printed traveler show it, and an unacknowledged revision on that block
raises a loud warning.

- **OFF until an owner turns it on** (`settings/pattern_hub.poIntegration`,
  a new `settings` collection — read by all, written by `isOwner()`). Not a
  100% gate: one forgotten baby tee would block it forever, so the hub
  shows a **coverage dial** (active GROOVY articles that need a pattern and
  have a live one — caps, retired articles and the other two brands are
  out, or 100% would be unreachable) and turning it on below 100% asks
  first and says how many are missing.
- **`po.pattern` — the free-text box — is NEVER clobbered.** It is
  someone's data. The traveler row is COMPOSED at render (`PTN-0007 ·
  Hook 3 / Slot 2 · <whatever was typed>`), so every old PO prints exactly
  as it did and nothing was migrated.
- **A PO with no `patternId` is resolved through its article code**, so POs
  written before this still show their pattern. A retired block is no
  block; an unassigned article **clears** the fields rather than leaving a
  stale link.
- **The warning is a warning.** The embellishment recipe gate already warns
  rather than blocks, and a hard block is what stops production at 2am for
  a paperwork reason. It says so on screen.
- **`js/pos.js` gained six touch points and nothing else** — each a
  `typeof`-guarded call into `js/patterns.js`, asserted as exactly *guard +
  call* per site, so a build without the Pattern Hub behaves precisely as
  before. All the logic lives in the module, the way `js/boards.js` wraps
  `startApp` rather than editing a cross-track file.
- **No PO render waits on a read.** The banner is a synchronous
  placeholder painted asynchronously (`ptnPoBannerSlot`) — the
  dashboard-widget pattern — and `_ptnPoEnsure()` loads the module's data
  once per session and cannot reject.
- **`firestore.rules` changed — `settings`.**

**M5 (shipped): revisions and the cutting notice.** Editing the grid stays
silent — entering ~8,000 numbers must not page anyone. A **revision** is an
explicit act ("Record a revision", one line of reason) and THAT is what tells
cutting what moved.

- **`patterns/{id}/revisions/{n}` is append-only** (rules: `update, delete:
  if false`), like `fabric_movements`. Each revision keeps a **full
  `snapshot` of the grid**, so the next diff is against the record itself
  rather than a baseline field that could drift from it — ~60 numbers, worth
  the bytes. `cells` holds only what moved, as `{from,to}` in inches.
- **The first revision has no prior snapshot, so every value reads as new.**
  That is cutting being told the spec exists, not noise, and it avoids a
  special case needing its own correctness argument.
- **`pattern_notices/{id}` SNAPSHOTS the article codes affected.** Deriving
  them live would rewrite history each time an article is reassigned; the
  notice records what cutting acted on.
- **One `writeBatch`** writes the revision, the notice and the bell row —
  a revision without a notice is a private diary, a notice without a
  revision points at nothing.
- The bell is the existing one (`hrm_notifications`, `forUser`,
  deterministic id, `actionUrl:'pattern-notices'`) exactly as Marketing M5
  does — **`js/hrm.js` needed no change** beyond a Me-page button.
- **Acknowledging writes exactly four fields** (`status, ackBy, ackAt,
  ackNote`) and may only ever set `status` to `acknowledged`; the rules'
  `hasOnly` list and `_PTN_ACK_FIELDS` are asserted equal — the Marketing
  M3 shape. A notice is never deleted.
- **A revision is refused while the grid has unsaved edits** ("a revision
  records what is saved"), and refused when nothing has changed.
- **THE AUDIENCE SPLIT INTO THREE LISTS HERE.** `_PATTERN_ADMIN_USERS`
  (afnan, ammar, mustafa) build everything and mirror
  `isPatternAdmin()`; `_PATTERN_CUTTING_USERS` (uzaib) mirror
  `isPatternCutting()` and may only acknowledge; `_PATTERN_HUB_USERS` is
  the two concatenated and gates the nav. Arfat is in none. Uzaib is a
  `viewer`, whose phone nav has no More sheet, so his route in is a **Me
  page button** — the Creative Hub pattern — and **`renderPatternHub()`
  returns the notices page for him**: one redirect rather than a second,
  emptier registry page.
- **`firestore.rules` changed — `revisions`, `pattern_notices`,
  `isPatternCutting()`.**

**M4 (shipped): the 5 × 6 in label — one per SIZE in the bundle.** Each
traced sheet gets its own sticker: block code (large), name, category, fit,
**SIZE** (large), the bundle, **HOOK / SLOT**, **every article using it**,
**this size's** measurements, a **QR** to the block (`#pattern=<id>`),
print date and when the grid last changed.
- **The article list is never capped (Sept 2026 fix).** It shipped with a
  12-article limit and a "+N more" for the rest — Afnan: a sticker sent to
  the cutting table has to be trustworthy on its own, not send whoever
  reads it to a screen for the remainder. `_ptnLabelData` now returns
  every code (`_PTN_LABEL_MAX_ARTICLES` removed) and `_renderPatternLabel`
  wraps the full list to however many lines it needs, instead of
  `.slice(0, 3)`. **The measurement rows below it still shrink to whatever
  room is left** — unchanged, already graceful ("no measurements
  recorded"/"+N more in the app") — so a long article list costs
  measurement rows before it costs anything else on the label. Known real
  max is 14 (Live In Pants' colourways, the flagship example this whole
  module is built around); nothing this large has ever pushed that
  fallback text toward the QR box, and no block anywhere near that size
  has been reported. Verified by reverting each half and watching the
  test fail (`got 12, expected 15`; the drawn text saying "more" again).

- **The engine gained a custom page size** (`data.page = {w,h}` in points;
  `_customPage()` validates it) and the `pattern-label` variant
  (`_renderPatternLabel`) **draws its own layout** — the shared A4
  components are `PRINT_LAYOUT`-bound (72 references, none read the page
  size) so it cannot borrow them, and `_stampFooters` is skipped on a
  custom page. Every other variant is untouched; 5 × 6 in = 360 × 432 pt.
- **The QR is built by the CALLER** (`_ptnQrMatrix` in `js/patterns.js`)
  with the vendored **`qrcode-generator` 2.0.4** and handed to the engine as
  a boolean matrix — the engine never learns about the library, the way the
  mood-board variant never learns how a board is drawn. Drawn with a 2-module
  quiet zone. **Vendored the documented way**: fetched from
  `registry.npmjs.org`, sha512 checked against `dist.integrity`, licence
  beside it, `?v`-less immutable path, `PRECACHE_URLS`, `onerror` CDN
  fallback. It is the UMD build and **not minified** (the package ships no
  minified file); `tests/invariants.test.js` derives the licence name for a
  plain `.js` now. JsBarcode is 1-D only, and a hand-rolled encoder is not
  where a bug belongs when 500 stickers are printed off it.
- **Operator-selected**: on a block, tick sizes (never-printed and changed-
  since are pre-ticked) → *Print ticked* / *Print all*; on the rack page,
  tick blocks → every size of each. One PDF, one page per label.
- **`p.labelPrinted[size] = {at,by}`** records the print — one update per
  block, never per size, and best-effort: a failed record never undoes a
  print that happened. `_ptnLabelStatus` reads *reprint* when the block
  (`updatedAt`), or **any article pointing at it** (`updatedAt`), changed
  after the print — assignment never writes the block, so the article side
  has to be checked too.
- **`#pattern=<id>` is the module's deep link**, consumed after `startApp`
  (wrapped, the `js/boards.js` pattern — `js/auth.js` untouched) and on
  `hashchange`, gated on the same audience as the nav.
- **No `firestore.rules` change** — `labelPrinted` lives on the block.
- **The first print on real sticker stock is the test.** Nothing here has
  been seen on paper or in a browser; the geometry is asserted against a
  recording fake jsPDF only.

**M3 (shipped): measurements.** `pom_templates/{id}` (top · pant · short ·
jacket, seeded from `_PTN_POM_SEED`, editable on `pattern-poms`: label,
how-to-measure text, optional Cloudinary photo, reorder, add, delete) and
the per-size grid on the block page.

- **The grid is on the block document** (`p.grid = {size:{pomKey:inches}}`,
  ~60 numbers) and is rewritten whole on Save — one write, a draft in
  memory until then, never a write per keystroke. **Inches are the only
  stored value, as a NUMBER, rounded to quarter inches on save.** cm is a
  per-viewer view (`localStorage['groovy-ptn-units']`) converted at render
  and on input; nothing in cm is ever written. `22 1/2` and `22,5` are read.
- **A cell that is not a number is left as it was and NAMED in the toast**
  — flagged, never rejected (the Mood Boards M4 cell lesson). Rounding is
  reported too.
- **Deleting a POM from a template never deletes recorded numbers.** A grid
  key no longer in the template or the block's extras renders as an
  *orphan* — greyed, "no longer in the template", with its own clear
  action — and the delete confirm says how many blocks hold numbers for it.
  `_ptnRowsFor(p)` is the single definition of "which rows a block shows":
  template points, then the block's own `extraPoms`, then orphans.
- A block starts from one template (`p.pomTemplate`, guessed from the
  category by `_ptnGuessTemplate`, chosen on the form) and may add
  block-only points (`extraPoms`, via prompt). Removing an extra keeps its
  numbers until cleared, same rule.
- **Tolerance is one global ±0.5 in** (`_PTN_TOL_IN`, Afnan Q23), stated on
  the grid. What it is checked AGAINST — a measured sample — is not stored
  in M3; the grid is the spec. The page says a sample check comes with
  revisions (M5), so nobody files it as missing.
- The seed writes only the templates that are missing, never over an
  edited one, and is refused on a failed read.
- **`firestore.rules` changed again — `pom_templates`.**

**M2 (shipped): blocks · `PTN-####` · the 10×5 hook map · assignment ·
the unassigned queue.** Pages `pattern-blocks` (rack + list), `pattern-block`
(one block), `pattern-unassigned` (the queue). Collections `patterns/{id}`
and `pattern_slots/{H-S}`.

- **The article→block link lives on the ARTICLE** (`articles/{code}.patternId`),
  never as an array on the block — the `columnId` lesson. Assigning is one
  batch of one update per article and **never writes the block document**;
  "which articles use this block" is a filter, not stored state.
- **A slot is a LOCK document** (`pattern_slots/{H-S}`, 50 possible ids,
  enforced by `key.matches()` in the rules), written in the **same
  transaction** as the block's `hook`/`slot` — the `creator_handles` shape —
  so two blocks can never take one slot; the refusal names who holds it.
  Moving releases the old lock and takes the new one atomically.
- **"Not on a hook" is a normal state.** The rack is 50 slots and the
  estimate is 60–130 blocks; the map shows an Unplaced strip rather than
  refusing. A lock whose block is gone renders as *stale* with a clear
  action — the one write that touches a lock alone.
- **A RETIRED block is "no block"** (`_ptnLiveBlock`): its articles keep an
  inert `patternId` (no write) but return to the queue and show unassigned,
  exactly as the retire confirm promises. Retiring releases the slot. Found
  by the test, not by reading — the first cut resolved retired blocks.
- **`PTN-####` comes from `getNextId('patterns')`** (`counters/main`,
  `js/shared.js`) and the create is a transaction that refuses an existing
  id; a number spent on a refused write is a harmless gap.
- **The clustering is a SUGGESTION and never applied** (`_ptnClusterKey`:
  category + style words, colourways and noise stripped — the planning
  analysis, ported). The queue groups by it with "Assign all N" (to an
  existing block) and "New block for these" (prefilled name, category, size
  axis guessed from the Shopify rollup, and the codes). A graphic tee names
  its artwork, not its shape, so the page says to trust your eyes.
- Caps (`needsPattern:false`) and retired articles are never offered and
  are refused by `ptnAssign`, which also says when an article was **moved**
  from another block rather than silently re-homing it.
- Measurements are M3; the block page carries a placeholder card so nobody
  files "measurements are missing" as a bug.
- **`firestore.rules` changed again — `patterns` and `pattern_slots`.**

**M1 (shipped): Shopify liveness · reconcile · TAC export.**
`shopify-catalog-sync.js` (the daily 9am-PKT sync, REST `/products.json`)
now also writes **`shopify_articles/{CODE}`** — one small doc per article
code (status, sizes seen, size axis, product ids/titles, image) — and lists
every product it could not key on `shopify_sync_meta/articles_rollup`
(`unkeyed_products`, with `reason: no_sku | foreign_sku`, and
`multi_code_products`). It also adds `image_url` to the per-variant write,
which was missing. The client reads ~336 rollup docs instead of ~1,500
variants — the Store read-quota lesson, applied before it could bite.

- **The SKU grammar is one regex in the function** (`ARTICLE_SKU_RE`):
  `GST073-XS`, `GD007-28`, `GHW001` (no size), `GCO001-T-M`. Anything else
  (`TOPS-030`, `FOG-02`, an empty SKU) is *listed*, never keyed under a
  guessed code. Rollup docs for codes that vanished from Shopify are deleted
  each run. `tests/catalog-sync.test.js` runs the real handler against an
  in-memory Firestore and a scripted Shopify.
- **`pattern-reconcile`** puts the registry beside the rollup in six buckets:
  codes not in the registry (one click adds them, code exactly as Shopify
  has it, title as name, counter moved past), name mismatches (Use Shopify
  name / Keep — "keep" writes `nameReviewedAt` so it stops nagging), products
  with no usable SKU (**title-matched** to a candidate, one click links),
  GROOVY codes not on Shopify (Retire), two codes on one product
  (informational), and **Fix in Shopify** — the SKU a human must type there.
  **Every write goes to `articles`; nothing here writes to Shopify.**
- **One normaliser** (`_ptnNorm` / `_ptnSim`, Dice on character bigrams —
  no library) serves the reconcile page and any future auto-link, so they
  cannot disagree. It recovers all 7 SKU-less denims by exact title;
  `_PTN_SIM_SAME` (0.72) is where a shared code's two names count as
  "substantially different" (a renamed colourway), `_PTN_SIM_LIKELY` (0.6)
  the floor for a title-only candidate.
- A link is `articles/{code}.shopifyLink = {productId,title,sku,reason,…}` —
  the registry's record of which product a code IS while the SKU is still
  wrong on Shopify. Once the SKU is typed in there, the next sync keys the
  product and the row disappears on its own.
- **The TAC list is an export now** — Excel (vendored SheetJS) and PDF
  (print engine `generic`, `urduLevel:'none'`), category-ordered. Ammar keeps
  a document; it can no longer drift from the app. **Tell Ammar.**
- **Every `pattern-*` page routes through `ptnRenderPage()`** — the `mkt-*`
  rule — so `js/shared.js` never needs another line for this module. Both
  loaders (`loadPatternsData`, `loadPatternsShopify`) cannot reject; a
  missing rollup says how to run the sync, a refused one names the
  collection and the republish.
- **`firestore.rules` changed again — `shopify_articles` (read-only).**
- **"Run sync now"** (hub and reconcile page, admins only) →
  `netlify/functions/pattern-sync-now-background.js`. The scheduled sync
  refuses direct HTTP with a 403 — a claim in this file said otherwise and
  cost Afnan a dead link — so the button POSTs an ID token to an unscheduled
  background wrapper that runs the same handler, then polls the sync's meta
  doc for the result (never left spinning: 4-minute timeout). Netlify
  ignores a background function's return value, so a refused caller sees
  nothing — the UI gate is what they see; the server gate is the boundary.

**M0 (shipped): the article registry — `js/patterns.js`, page `pattern-hub`.**
The TAC list (Ammar's `TAC List Complete.docx`, verified against Shopify on
16 Sept 2026) lives in the app now and the app mints codes; the document
becomes an export in M1. Collections `tac_categories/{PREFIX}` (the minting
counter) and `articles/{CODE}`.

- **The article's doc id IS its code.** Uniqueness is the document; a mint is
  a `runTransaction` that reads the article first and refuses if it exists.
- **Minting is next-after-highest per category.** TAC's holes (`GH036`,
  `GS016`–`GS022`) are human errors, not reservations (Afnan), so the counter
  never fills one on its own — an admin may type an explicit unused code to
  fill a gap deliberately. `nextNumber` never moves backwards, and is
  **floored at the seed's max + 1** so a hand-edited counter can never hand
  out a code the TAC list already used. A co-ord (`GCO`, form `NNN-TB`) mints
  a `-T`/`-B` pair from one number in one transaction.
- **`needsPattern` lives on the category** and is inherited at seed/mint,
  overridable per article. Headwear (`GHW`) is the only `false` — caps get
  codes, never patterns.
- **The Shopify SKU is the article code plus size** (`GST073-XS`). That join
  key already exists; nothing maps it. `PRODUCT_CATALOG` in `js/shared.js`
  is a stale snapshot missing 88 active codes and this module is **not**
  built on it — retiring it is a later, cross-track job.
- **A failed read and an empty registry render different screens**, and
  **the seed is never offered on a failed read** — it would rewrite a live
  registry it could not see. `_ptnLoadFailed(col)`, the Store lesson.
- **Audience by username** (M0 shipped one list; M5 split it into three —
  see M5 above. `_PATTERN_ADMIN_USERS`: afnan, ammar, mustafa) —
  Arfat holds the manager role and gets nothing, like every Sept 2026 grant.
  `firestore.rules` mirrors it as `isPatternAdmin()` (owners + `isMustafa()`,
  never `isManager()`); `tests/patterns.test.js` asserts the two lists are
  the same people. `js/shared.js` reaches the gate from two routes behind
  `typeof` guards that fail closed. To widen: edit the list, and the rules.
- **`firestore.rules` changed in M0 — it needs a republish** before anyone
  can seed. The page's own error card says so.

Data facts worth not re-deriving: 350 active Shopify products, 336 distinct
codes; 11 products with no usable SKU, 7 of them recoverable by title (all
denim); the Jorts `GJO001`/`GJO002` codes are **swapped** on Shopify vs TAC;
`GCO001–008` duplicate their `GHZ`/`GST` twins; `GST062`/`GSO003`/`GB025`
are renamed colourways. All four are Ammar's calls, all resolved in M1's
reconcile page, none blocking M0. Four size axes exist (alpha incl.
XXXS/XXS, numeric waist, none, legacy) and `PO_FLOW_SIZES` covers only one —
**deliberately left alone**; the hub carries its own sizes per pattern.

**Nothing in this module has been looked at in a browser** — the sandbox
cannot sign in [29 Sept: a headless QA session can sign in and render — see "Sandbox limits"]. Logic and the real-Chromium script load are tested.

## Profiles (Sept 2026)

Afnan asked for "a general Profile for each login where people can add their
picture, change name, add document info such as CNIC number, emergency
number, full address, as everyone I want to assign Groovy Ops to should have
this basic respect for data entry."

**The second half was raised as a problem and dropped by agreement.**
`user_profiles` is readable by every signed-in user, so a CNIC, a home
address or a next-of-kin number put there would be readable by every worker
with an account — a directory, not a record. Identity documents belong in
the HRM `employees` records, behind the owner/manager gates that already
exist. **Do not add those fields here later without moving the collection
behind a per-person read rule first.** The edit form says so on screen, in
the box, because a free-form "About" field is exactly where someone will
type their CNIC if nothing tells them not to.

What a profile holds: `photoUrl`, `displayName`, `jobTitle`, `department`,
`about` — plus `uid`, `username`, `updatedAt`.

- **Keyed by Firebase uid, never by username.** A username is a display-layer
  thing in `USER_DEFS`; the uid is the only stable identity, and it is what
  the rule checks. `firestore.rules`: read `if signedIn()`, create/update
  only when **the document id IS the caller's uid AND the payload's `uid`
  agrees with it** (so nobody can write a profile for someone else, or claim
  another uid inside their own), delete `if isOwner()` for moderation —
  the fabricin/loans pattern.
- **A stored photo URL is never trusted.** `_profPhotoUrl` accepts only an
  `https://res.cloudinary.com/…` URL and nothing else, because that string
  goes into an `<img src>`. Note the host test is anchored — a lookalike
  like `res.cloudinary.com.evil.test` is refused. Avatars request a sized
  `c_fill,g_face` derivative (`_profAvatarUrl`), the same trick
  `_boardsDisplayUrl` uses; the stored URL is never rewritten.
- **User text is hydrated with `textContent`** (`_profileHydrate`) after the
  structure renders — same stored-XSS boundary as Notes' blocks, board cards
  and board comments. A display name and an "about" line are written by one
  person and read by every other one.
- **`loadProfiles()` cannot reject**, per the rule under "Loading must never
  hang" — `renderPage` dispatches it with no `.catch`. A denied read renders
  an honest error card with Retry that names `firestore.rules`.
- **The directory lists every `USER_DEFS` account**, not only those who made
  a profile. A directory that lists only the keen is not a directory.
- **Reached from a topbar avatar**, not a nav item — it is for everyone
  regardless of role, and the topbar is the one surface every role sees.
  **That is exactly what a role-scoped redirect broke.** `showPage`
  (`js/shared.js`) scopes the `fulfillment` account to one page by
  REWRITING every id, so `showPage('profile')` silently became
  `showPage('fulfillment')`: the page did not change, nothing was logged,
  no request was made, and there was no way for the person in front of it
  to tell "blocked" from "broken". `_CHROME_PAGES` now exempts the pages
  reached from the app CHROME rather than the sidebar — `profile` and
  `bug-tracker` (the notification panel's "View →"). **Anything new that
  is reachable from the chrome belongs in that list**, and
  `tests/invariants.test.js` checks both halves: the exempt pages get
  through, everything else is still scoped away, and every page named in
  `_CHROME_PAGES` is actually dispatchable by `renderPage` (or the
  exemption just swaps one silent no-op for another).
  `_profilePaintAvatar` repaints it; `profileBootstrap()` is called from
  `startApp` (js/auth.js) and **never awaited** — see "Diagnostics" for the
  white screen that cost.

### Admin profile editing (Sept 2026)

Afnan asked for himself, Ammar and Mustafa to edit other people's profiles
and set their passwords, with **Mustafa explicitly unable to touch his or
Ammar's**. `_PROFILE_ADMINS` / `_PROFILE_PROTECTED` in `js/profile.js`, and
by USERNAME — Arfat holds Mustafa's `manager` role and gets none of it,
same as every other Sept 2026 grant.

- **Three layers have to agree, and only two of them are boundaries.**
  `js/profile.js` decides what the UI offers (not a boundary);
  `firestore.rules` decides whether the profile write lands; and
  `netlify/functions/admin-reset-password.js` decides whether the password
  actually changes, on the caller's own verified ID token. Change one,
  change all three — `tests/invariants.test.js` now fails if they disagree.
- **The uid problem, and the seed that solves it.** Profiles are keyed by
  Firebase uid and nothing client-side maps a username to one. So
  `profileBootstrap()` now **seeds `user_profiles/{uid}` with
  `{uid, username}`** the first time someone signs in with no profile doc —
  written by that person, under the unchanged self-create rule. That seed is
  the only thing that makes "edit someone's profile" possible at all. It
  fires **only on a snapshot that really came back and really doesn't
  exist**: a read that timed out or was denied must never trigger it, or a
  bare row lands on top of a real profile. Someone who has not signed in
  since this shipped has no row, and the directory says "Not signed in yet"
  rather than offering a button that cannot work — their *password* can
  still be reset, since that path goes by email.
- **`create` in `firestore.rules` stays self-only.** An admin cannot mint a
  profile for someone else; allowing it would only add a way to write a doc
  at a guessed id. `update` carries the admin clause, and an admin update
  **may not change `username`** (`request.resource.data.username ==
  resource.data.get('username','')`) so a profile can't be relabelled as
  somebody else's. **This changed `firestore.rules` — it needs a republish.**
- **The login ID is shown read-only.** Changing it means a Firebase Auth
  account plus a `USER_DEFS` entry — a code change and a Console change, not
  something a form can fake. The edit card says so rather than offering a
  field that silently does nothing.
- **"Sync accounts" is the way out of the chicken-and-egg.** A profile row
  is keyed by Firebase uid, so an admin cannot edit anyone who has not
  signed in since profiles shipped — there is no row to write to.
  `netlify/functions/admin-seed-profiles.js` (owners + Mustafa, verified
  server-side on the caller's own ID token, same gate as the password
  reset) resolves each `USER_DEFS` email to a uid with the Admin SDK and
  writes `{uid, username}` **with `{merge:true}` always** — it seeds, it
  never resets, and an existing profile is untouched. It reports per
  account: created / already had one / **no Firebase Auth account** (that
  person is in `USER_DEFS` but cannot sign in at all — worth knowing) /
  failed. Reached from the Team card on the Profile page, admins only.
  `tests/invariants.test.js` checks its gate and that every write merges.
- **The profile picture is a BUTTON.** Afnan reported "nothing happens when
  I click the profile picture to edit" — and nothing did: in view mode it
  was a plain `<img>` with no handler, so the most obvious control on the
  page was inert. It now opens the editor **and** goes straight to the file
  chooser in the same gesture (the rerender is synchronous on purpose — a
  browser refuses a file dialog outside a user gesture, so it cannot be
  deferred). Directory avatars are clickable too, for the same reason.
  `window.profileStartEdit` / `profileEditUser` / `profileChangePhoto` all
  route through `_profileGuard`, because a throw inside an inline `onclick`
  goes to `window.onerror` and the button just looks dead.
  **Verified in a real browser, not only the harness**: the Edit button and
  the photo button were both hit-tested with `elementFromPoint` and clicked
  as Umair's account — both reach their handler with no errors. The report
  that "Edit profile" itself does nothing could not be reproduced anywhere;
  the screenshot showed the "Refresh now" update banner still on screen, so
  the most likely explanation is an old cached build.
- **`_profileRerender` can never fail silently.** A throw inside
  `renderProfilePage` used to leave the page exactly as it was, so a button
  appeared to do nothing at all — no error, no clue, nothing the person in
  front of it could report. It now catches, logs, and renders the message
  on screen (built with `createElement` + `textContent`, since an error can
  contain anything) with a Reload button. Same principle as the diagnostics
  panel. **Any page whose repaint goes through one function should do
  this** — it is five lines and it converts the least reportable class of
  bug into a readable one.
- **A directory tile is a COLUMN, and the name never shares a row with a
  button.** The first cut put identity and actions in one flex row inside a
  `minmax(220px,1fr)` tile; the actions are `flex-shrink:0` and the name is
  `flex:1;min-width:0`, so the name collapsed to **zero width** on every row
  that had buttons — only the signed-in person's own row, which has none,
  read correctly. Every row showed an initial and "Not signed in yet" and
  nothing else. Measured: 0px before, 177px after, same window. Each tile
  now stacks identity → role line → actions, carries `@username` **in the
  markup** (not only in the hydrated name) so a row is identifiable even if
  hydration never runs, and marks your own row. `tests/smoke-layout.js`
  fails if it regresses. **Anything added to a tile goes BELOW the identity
  block, not beside it.**
- **Name colours** (`p.nameColor`) are a validated `#RRGGBB` on the profile,
  rendered on the directory, the profile card and the topbar, and exposed as
  `window.profileNameColor(username)` for the activity log / board presence /
  comments to pick up later. Validation **reuses `_boardsValidHex` /
  `_boardsInkOn`** from `js/boards.js` (loaded immediately before
  `profile.js`; classic scripts share one lexical scope) rather than
  carrying a second copy of the same rule — guarded with `typeof` so that if
  boards.js ever fails to parse the colour is **dropped**, never passed
  through unvalidated into a `style` attribute. Fail closed.

**A chosen display name has one knock-on, and it is handled.** `session.name`
is what `logActivity`, board presence and board comments all write, so a
rename follows the person everywhere — including into the `activity`
collection, where **Monitor tiers people by matching `a.user` against
`USER_DEFS` names**. A renamed owner would have silently dropped into
"Everyone else". So `logActivity` (`js/shared.js`, a **cross-track file** —
this was a one-field additive change) now also writes `u: session.u`, and
`_monitorRoleTier(name, username)` prefers the username when the row carries
one, falling back to name-matching for every row written before this.

## Type scale — "Comfortable" (Sept 2026)

Afnan, after the Pattern Hub screenshot: *"the texts are too small dont you
think you have to focus to read."* Counted before touching anything —
`grep -ohE 'font-size:[0-9.]+px' css/main.css js/*.js` — and the base body
size (14px) turned out to be almost never used: **11px and 12px alone were
1,258 of the app's font-size declarations**, with 323 more at 10px or
below. A specimen page (three scales, the app's own font stack, the real
measurement-grid and dashboard markup, switchable live) was published for
Afnan to judge at real size before anything shipped; he picked
**Comfortable**.

**The rule, applied mechanically everywhere:** `f(x) = x<11 ? 11 : x+1`.
Every size below 11px floors at 11 (the two smallest steps merge — nothing
below 11 was worth keeping, so this is a simplification, not a loss);
every other size moves up exactly one pixel. `12px→13px`, `14px→15px`,
`18px→19px`, `24px→25px`, and so on including every half-step
(`12.5px→13.5px`). Applied by script across **css/main.css and every
`js/*.js`**, matching only a literal `font-size:<number>px` — **2,431
sites in one deterministic sweep**, verified both by `node --check` on
every file and by re-running the entire test suite (still 2,485/2,485 —
these are pure numeric bumps, not structural changes) plus
`tests/smoke-layout.js` across all fragments, all three widths, both
themes (114/114 — the check that would have caught a bigger size clipping
a tight badge or table header).

- **This is a literal value sweep, not a token layer.** The plan floated
  to Afnan before building was nine CSS custom properties
  (`--t-micro`…`--t-num`) with every site swapped to reference them — the
  dark-mode shape. That was **not** what shipped: classifying ~2,400
  untyped inline `style="…"` sites into the correct semantic step
  reliably, in one pass, with no way to verify a wrong classification
  automatically, was the riskier and less honest option. A deterministic
  numeric function needs no per-site judgment call and is trivially
  reversible (subtract the same function). **If a token layer is wanted
  later, this sweep is the version to build it FROM** — the sizes are
  already right, only the indirection is missing.
- **What the sweep did NOT touch, and why, each confirmed from the code
  first:**
  - **`clamp(...)` sizes** — the Mood Boards Presentation-mode slide text
    (`.bp-kicker`/`.bp-title`/`.bp-sub`/`.bp-body`/`.bp-cap`/`.bp-list`/
    `.bp-table` in `css/main.css`) is already responsive and already large
    (up to 76px); the regex requires a literal `<number>px` immediately
    after the colon, so a `clamp(11px,1.4vw,14px)` value never matched —
    confirmed by grepping for `clamp(` separately before running the
    sweep, not by trusting the regex.
  - **`pt` sizes** — the two `win.document.write` print windows
    (`js/boards.js`'s Word-export slide CSS, `js/fabric.js`'s gate-pass/
    label print CSS) size physical output in points on a fixed physical
    tag or page, not screen chrome; the regex matches `px` only, so these
    were never candidates. Same standing exclusion as the dark-mode sweep,
    for the same reason: these documents never load `css/main.css` and
    aren't screen reading at all.
  - **Computed avatar-initial sizes** — `js/activity.js`'s and
    `js/boards.js`'s `font-size:${Math.round(size*0.38)}px` scale with
    their own tile size already (a ratio, not a fixed value), so the
    regex — which requires a literal digit right after the colon — never
    matched the `${…}` in between. Confirmed deliberately, not accidental:
    these already read correctly at every tile size, and bumping the ratio
    would just change the ratio, not fix anything.
  - **`js/print-engine.js`'s PDF-drawing sizes** (`PRINT_SIZES`, the
    `_render*` component functions) are jsPDF point values with no `px`
    unit at all — never candidates. Its two `win.document.write` preview/
    error tabs (`_previewLoading`, `_previewError`) **are** real on-screen
    HTML pages with no `css/main.css` (self-styled, like
    `js/diagnostics.js`), so — unlike the dark-mode sweep, which excludes
    this whole file — their **4** literal px sizes were bumped like any
    other screen text; nothing about them depends on CSS custom
    properties, only on being readable.
  - **`js/diagnostics.js`** was swept too (4 sites) — excluded from the
    dark-mode CSS-token sweep because it must render when
    `css/main.css` itself is what failed and can't depend on a custom
    property, but a plain literal pixel number has no such dependency, and
    the panel it draws is exactly the kind of "someone is squinting at
    this on a phone" screen this whole change is for.
- **`CACHE_VERSION` bumped once for the whole sweep** (not once per file)
  — 20 `/js/*.js` files plus `css/main.css` all changed in the same
  commit, so one version bump past whatever `origin/main` held covers all
  of them; every touched file's `?v=` query string in `index.html` was
  bumped alongside it to the same tag, though (per "How the fetch handler
  routes" above) the service worker itself only cares about
  `CACHE_VERSION` — the `?v=` bump is belt-and-braces for plain HTTP
  caching outside the SW, not load-bearing for the offline cache.
- **Not verified from here, same as dark mode:** nobody has looked at the
  new sizes on a real phone or in a real browser — the sandbox still
  cannot sign in [29 Sept: a headless QA session can sign in and render — see "Sandbox limits"]. The specimen artifact was published specifically so
  Afnan could judge the actual sizes before this shipped, rather than
  trusting a description of pixel counts; the app itself still needs a
  human pass.

## Dark mode (Sept 2026)

Asked for on the Profile page; applies to the whole app. `Profile →
Appearance` offers **Light / Dark / System**, persisted per device in
`localStorage['groovy-theme']` — never on the profile document, since a
theme is about the screen you are looking at, not who you are.

- **`index.html`'s `<head>` stamps `data-theme` on `<html>` BEFORE the
  stylesheet link**, so there is no flash of the wrong theme. Tiny, inline
  and dependency-free, the same shape as the diagnostics error seed.
  `js/profile.js` owns the toggle and keeps following the OS while the
  preference is `system`.
- **It is a TOKEN swap, and deliberately NOT a `filter: invert()` trick.**
  A non-`none` `filter` on `html`/`body` makes that element the containing
  block for every `position:fixed` descendant — it would break the board
  canvas takeover, `#bug-report-fab`, the toasts and every modal in the app.
  Verified reasoning, not a preference; `tests/invariants.test.js` asserts
  no such filter exists.
- **`--dark` and `--red` invert.** They are the app's "strong contrast
  chip", so in dark mode they become light and `--on-dark` becomes dark —
  every rule using the pair keeps working untouched. New tokens:
  `--surface-2` (inputs / striped rows), `--on-dark`, `--hover`, `--line`.
- **The sweep was property-qualified, never bare-hex.** `css/main.css` and
  ~434 inline `style="…"` attributes across `js/*.js` had
  `background:#fff` → `var(--surface)`, `color:#111` → `var(--text)` etc.
  A bare-hex sweep would have turned a white foreground on a hard `#dc2626`
  button into dark-on-red, so **`color:#fff` is only converted when nothing
  in the same style string paints a fixed background** (a literal, a
  `${…}`, a gradient). Reuse that guard if you sweep more.
- **`js/diagnostics.js` and `js/print-engine.js` are deliberately
  excluded** and must stay that way. Diagnostics has to render when
  `css/main.css` is itself what failed, so it cannot depend on a custom
  property; print-engine draws into a PDF, where there is no CSS at all.
  Both are asserted in `tests/invariants.test.js`.
- **The wordmark is inverted with a CSS `filter` on the `<img>`** — it is
  black artwork on transparency and would vanish on a dark bar. Safe there:
  an `<img>` has no fixed descendants.
- **What is verified and what is not.** A headless-Chromium probe confirmed
  every token resolves and the computed colours flip correctly in both
  themes (body, topbar, cards, buttons, the red QC button keeping white
  text). **Nobody has LOOKED at the app in dark mode** — ~~the sandbox still
  cannot sign in (gstatic is blocked)~~ *(SUPERSEDED 29 Sept 2026: gstatic answers, and a
  headless QA session has signed in and rendered the Board page — but it made no screenshots
  and did not walk the other pages; see "Sandbox limits")*, so page-by-page visual confirmation
  needs the human. Expect leftover light patches in the corners the
  property-qualified sweep could not reach (gradients, `el.style.x='#fff'`
  assignments, chart and badge colours); they are a follow-up pass, best
  done one file at a time so each can be eyeballed.

### Dark mode — the embellishments track (Sept 2026)

`js/embellishments.js` was left out of the original property-qualified sweep
because it is **Ammar's file** per the domain map. Afnan asked for it to be
done anyway; tell Ammar it changed. Three distinct failure shapes were in
there, and only the first is the one the earlier sweep looked for:

- **A fixed light background behind a foreground that follows the theme.**
  Every SLA panel did this (`{ok:'#EFEFEF',near:'#f0f0f0',over:'#fee2e2',
  critical:'#fecaca'}` behind `var(--green)`/`var(--amber)`/`var(--muted)`),
  as did the PP-attempt rows, the recipe hover rows and the placement
  panels. In dark mode these render **light-on-light** — measured at 1.03:1.
  Fixed by tokenising the BACKGROUND, so both halves move together.
- **A fixed dark foreground on a background that follows the theme.** The
  priority chip built its own background by appending an alpha suffix to a
  near-black literal (`'#111111'+'22'`) and used the same literal raw as the
  text, so it was black-on-black. `PRIORITY_COLORS` holds tokens now and
  **`_embPriorityChipStyle()` is the single definition** the four call sites
  share. The Observer Tower's per-stage `border-bottom:2px solid #111111`
  and the dashboard's `color:'#111'` stat numbers were the same shape.
- **White text on `var(--dark)`.** The worker card's "CURRENT STEP" hero
  paints on `var(--dark)` — which **inverts**, so in dark mode it is a
  *light* panel — while its three inner lines hardcoded
  `rgba(255,255,255,.5/.85/.8)`. They use `var(--on-dark)` with an `opacity`
  now. **Anything painted on `--dark` must take its ink from `--on-dark`;
  a literal white is only correct where the background is also literal.**

**Chips whose background AND text are both literal were still converted**,
though they are readable in both themes — a white `#f0f0f0` chip on a dark
page is what Afnan reported as "not in the right color tone". That is the
one place this sweep went further than the first one.

**Deliberately untouched:** `#dc2626` and friends sitting straight on a
token surface (readable in both, ~3.2:1) and the Pantone hex data in
`COLOR_IMPORT_PANTONE_HEX` / `hexApprox` fallbacks — those are **ink
colours, i.e. content**, not chrome. And, critically, **the two
`win.document.write` print windows** (`renderBlankPlacementSheet`,
`generateJobSheetPDF`'s job card): those documents never load
`css/main.css`, so a `var()` in them resolves to nothing at all. The sweep
script hard-excluded their line ranges. Same rule as `js/print-engine.js`
and `js/diagnostics.js`.

**The notification bell was missed by both sweeps (fixed 17 Sept 2026).**
`_ensureNotifBell` painted `#notif-panel` with a literal `#fff`, and
`_hrmNotifCardHTML` gave normal/low cards `#fff`/`#fafafa` backgrounds and a
`#1A1A2E` title, while the message text used `var(--text)` — light text on
a white card in dark mode, reported from Daniyal's screen. All tokens now;
`smoke-layout` has an `hrm — notification cards` fragment, verified to fail
in dark on the old code. (The advance/loan notices he saw were genuinely
his: `js/hrm.js` seeds an employee `daniyal`, and this was his first
sign-in, so nothing had dismissed them.)

`tests/smoke-layout.js` gained the fragment that proves it — the real
`printWorkerCardHTML`, `renderPPAttemptsCard` and `renderTowerSwimlane`
output at ok/near/over/critical. **Verified both ways:** reverting the
`slaColors` map alone fails it at 1.03:1 and 1.4:1, naming the exact text.

**It also found a gap in the probe itself.** `display:none` on an ANCESTOR
does not appear in a descendant's own computed style — the child keeps
whatever `display` it specified — so every collapsible form in this app
(the delay-reason textarea, the QC defect rows) reported as zero-size
invisible text. `hiddenEl()` walks up to `#main-content` instead, and all
four checks use it.

### Dark mode — the app-wide sweep (Sept 2026)

Afnan, with a screenshot of Inventory Intel: *"look at the color of dark
mode, i cant read the table."* He was right, and the cause was one rule.
The round that followed swept the whole app for the same shapes. **Every
claim below was MEASURED in headless Chromium in both themes, never read
off the source**, and each fix was verified by reverting it.

**The reported bug: `.cut-table th` — measured 1.1:1.**
`background:var(--dark);color:rgba(255,255,255,.6)`. `--dark` is the app's
"strong contrast chip" and **inverts**, so in dark mode that is near-white
ink on a near-white bar. It had been invisible since dark mode shipped, on
**every `.cut-table` in the app** — Inventory Intel just happens to be the
page that puts the most numbers on screen. The rule that "anything painted
on `--dark` must take its ink from `--on-dark`" was already written down
for the embellishments sweep; this rule predated it and was never revisited.
An alpha becomes an `opacity` so the muted label look survives both themes.

**The four shapes, and only the first is the one earlier sweeps looked for:**

1. **White-alpha ink on a `--dark` panel** (1.03–1.10:1). The *value* beside
   it already used `--on-dark` and read perfectly, which is exactly why
   nobody noticed the *label* had gone. 13 sites in `gatepass.js` and
   `fabric.js`, plus `.cut-table th`, the board heading placeholder, and the
   Users-page avatar initial.
2. **A fixed light panel with token ink** (1.04–1.14:1). `#fffbeb`,
   `#fef2f2`, `#f0fdf4`, `#f7f7f8` … carrying an inherited `var(--text)`.
   The accent `*-soft` tokens already invert and their LIGHT values are
   these very colours, so mapping the background is a no-op in light mode
   and fixes both halves in dark.
3. **A fixed dark ink on a token surface** (1.02–1.74:1). `#111`, `#1A1A2E`
   (the brand navy), `#333`, `#374151`, `#1e3a8a`. The worst was the SKU
   table's own on-hand total.
4. **Bright patches that are readable but wrong in tone** — self-consistent
   literal chip pairs (`#f0f0f0`/`#111`, `#dcfce7`/`#166534`, `#e0e7ff`/
   `#3730a3`) glaring off a dark page. Converted, for the same reason the
   embellishments sweep converted its chips.

Also swept: seven `border-bottom:1px solid #f5f5f5` hairlines in
`css/main.css` (a bright line straight across a dark card — the leftover the
Store log's pager had), `.cash-action-bar`'s fixed white bar, the board
drop-zone, the white skeleton shimmers, and `fabric.js`'s busy overlay,
which flashed a white scrim over the whole app.

**Two of the sweep's own replacements were wrong, and the measurement is
what caught them — not review:**

- **`#ccc`/`#ddd` ink → `var(--border)` is too faint** (1.33:1). Those sites
  are remove-**×** buttons and empty-state glyphs: faint on purpose, but
  they still have to be seen. `--muted` is the token that means "faint but
  legible". **`--border` is a line colour; it is never ink.**
- **A `.btn-sm` background → `var(--soft)` broke it in LIGHT mode** (1.15:1).
  The class already sets `color:var(--on-dark)`, which only reads on a solid
  chip. A grey button wants `--muted`, not a pale surface. **Before changing
  any element's background, check what its CLASS sets for `color`.**

**What the sweep deliberately did NOT touch**, all confirmed by reading the
call site rather than assumed:

- `win.document.write` print windows (`embellishments.js` ~3849) — those
  documents never load `css/main.css`, so a `var()` resolves to nothing.
  Same standing rule as `js/print-engine.js` and `js/diagnostics.js`.
- `.hrm-greeting` and the bug-report modal header — fixed dark **gradients**
  with white ink, self-consistent in both themes.
- Solid saturated buttons (`#dc2626`/`#fff`, `#1A1A2E`/`white`) — readable
  on a dark page and semantic.
- `rgba(0,0,0,.5)` modal backdrops and shadows, and the Pantone hex data,
  which is **content** (ink colours), not chrome.

**The probe technique, worth reusing.** Extracting every `style="…"` string
in `js/*.js` and measuring each one in isolation is tempting and produces a
**flood of false positives**: a child whose ink is `var(--on-dark)` gets
rendered without the `background:var(--dark)` parent that justifies it, and
a `.btn-primary` loses the `color` its class supplies. **The filter that
makes it usable: keep only what fails in DARK and passes in LIGHT.** A
self-contained style broken in both themes is almost always a missing
parent, not a bug. That cut 53 raw hits to 9 real ones, and the final sweep
reports **0 dark-only failures** across 860 style strings.

`tests/smoke-layout.js` gained two fragments. **`inventory intel — SKU
table` needs one non-obvious row to be worth anything:** a variant with
**no `onHand` at all**. `totColor`'s three branches are `allInStock ? … :
anySoldOut ? … : '#111'`, and for numeric stock those first two are exact
complements — the third is unreachable. Only a variant Shopify has not
reported inventory for (both `>0` and `<=0` false) reaches it. The first cut
of the fragment used ordinary rows, **passed with the bug restored, and
proved nothing.** `gate pass — dark summary panels` covers shape 1. Both
verified by reverting: 3 dark checks fail each time, naming the elements.

## Shopify Inventory Intelligence

Read-only sales + inventory dashboard ("Inventory Intel" page). Data is
pulled from the live Shopify store (`groovypakistan.com` / GROOVY™
Streetwear) into `shopify_*` Firestore collections by **Netlify
Functions** (Node, `firebase-admin`, service-account writes), then read
client-side.

- **Client (`js/shopify.js`):** `loadShopifyData()` + `renderShopifyDashboard()`.
  Read-only — never writes. Categories are derived **dynamically** from
  whatever `product_type` strings exist (no hardcoded category list / color
  map); blank/whitespace types fall into an `'Unknown'` bucket. The "By
  Category (7d)" panel is **line-item based** (keeps historical category by
  design); Weeks-of-Supply is **catalog/product based** and skips
  `status==='archived'` rows so the discontinued archive doesn't swamp
  `'Unknown'`.
- **Functions (`netlify/functions/`):** all auth to Shopify via Client
  Credentials Grant; env vars `SHOPIFY_CLIENT_ID/SECRET`,
  `SHOPIFY_STORE_DOMAIN`, `FIREBASE_SERVICE_ACCOUNT`.
  - `shopify-catalog-sync.js` — **scheduled DAILY at `0 4 * * *` UTC
    (9am PKT)** in `netlify.toml`. **Since Sept 2026 it also writes the
    Pattern Hub's `shopify_articles` rollup + `shopify_sync_meta/
    articles_rollup`, and `image_url` on each variant** (see "Pattern Hub").
    **It CANNOT be run by opening its URL.** This file used to say a GET
    runs it on demand; that was never verified and it is false — Netlify
    answers a direct HTTP request to a *scheduled* function with **403**
    (seen in Afnan's browser, 17 Sept 2026; the same is true of every
    function with a `schedule` in `netlify.toml`). **To run it now: the
    "Run sync now" button on the Pattern Hub**, which POSTs to
    `pattern-sync-now-background.js` — a separate, UNscheduled background
    function that verifies the caller's ID token against
    `PATTERN_ADMIN_EMAILS` (= `isPatternAdmin()`) and then calls this
    handler. It answers 202 at once, so the button polls
    `shopify_sync_meta/catalog_sync.last_run_at` and reads the summary from
    there. **`shopify_products` is therefore only as fresh as 9am PKT
    today** unless someone presses that button — anything that reads the
    catalog (the Marketing product picker, M2) is "current as of this
    morning", not live.
    Fetches all products (`status=active,draft,archived`) and writes **one
    doc per variant** to `shopify_products/{variant.id}` via
    `batch.set(...)` **without `{merge:true}`** → a re-sync **fully
    overwrites** every doc (incl. `product_type`), so a plain re-run is the
    backfill — no separate upsert path needed. Flags products whose options
    aren't `Color`/`Size` (`needs_review:true`); informational only. Writes
    a run summary to `shopify_sync_meta/catalog_sync`.
  - `shopify-inventory-snapshot.js` — scheduled daily (`0 1 * * *`).
  - `shopify-order-backfill.js` window (30 Sept 2026). No schedule. **Since the backend phase it requires a verified owner ID token
    (POST only, afnan/ammar)**; the old "no auth gate, plain GET" wording is superseded (`/.netlify/functions/shopify-order-backfill`, ~9s
    budget per call, resumes from `shopify_sync_meta/order_backfill`). Default
    is still 90 days. `?days=N` (1..3650) or `?since=YYYY-MM-DD` sets the window;
    bad values get a 400 before any work. A FINISHED backfill is re-opened only
    by an explicit window reaching earlier than its stored `created_at_min`, and
    then fetches just the older slice (`created_at_max` = old minimum); orders
    already in `shopify_orders` are skipped by id, never rewritten. A run in
    progress resumes with its stored window and ignores the parameter.
    `tests/shopify-backfill-window.test.js`. Unverified against live Shopify.
  - `shopify-order-sync.js` — scheduled every 4h (`0 */4 * * *`).
  - `shopify-weekly-close.js` — scheduled Sat (`0 2 * * 6`).
  - `shopify-order-backfill.js` — resumable historical order backfill
    (BulkWriter, time-budgeted to dodge 502s); `shopify-inventory.js` —
    connection test. (Schedules live in `netlify.toml`.)
- **SKU table ▸ "Sold since live" (30 Sept 2026).** A column after Sold 30d:
  lifetime units per variant (`totalSold`, non-refunded line items, the same
  rule as 7d/30d; a group row sums its variants) with "live Nd" underneath.
  The live date is `published_at`, falling back to `created_at`, earliest
  across a group; "live —" when neither is stored, never a guess. The sort
  key is `totalSold`. **`shopify-catalog-sync.js` now also writes
  `published_at`; it fills in only after the next catalog sync run** (until
  then `created_at`, already stored, is used). **Coverage limit, read from
  code:** `shopify_line_items` holds only what the order sync (4h lookback)
  and `shopify-order-backfill.js` (`BACKFILL_DAYS = 90`) wrote, so the number
  understates products launched earlier; a caption under the legend names the
  earliest synced order date. Whether the live collection was ever backfilled
  further is unknown. `tests/shopify-sold-since-live.test.js` (20), each
  assertion verified by breaking it. Nobody has seen it on a real screen.
- **Collections:** `shopify_products` (per-variant catalog), `shopify_orders`,
  `shopify_line_items` (keep historical `product_type` by design),
  `shopify_inventory_snapshots`, `shopify_weekly_closes`, `shopify_sync_meta`.
  All are `read: if signedIn(); write: if false;` in `firestore.rules` —
  only the Admin SDK (Functions) writes; clients read-only.

### Inventory Intel ▸ loading screen, honest percentage and retry (1 Oct 2026, v287)

`js/shopify.js` block "Loading, honest percentage and retry"; CSS `.si-ld-*`; `docs/UNITS_METRICS.md` has the rules. **`loadShopifyData` now resolves when the load has SETTLED** (loaded, or failed for good after its automatic retries) and `_siLoaded` says which; `js/shared.js`'s dispatch line and its 90s race are unchanged and the controller's own 90s timer fires first. Seven stages (`_SI_STAGES`, weights 4/10/50/1/14/3/18), `siProgress` (pure, capped 99), `siMark` (the only place progress moves, monotonic), `_siRetryCtl` (timer, tick, per-stage `running`, `gen`). Each collection read assigns its own result and sets `_siColl[id]`, so a retry re-reads only the failed stage (the Store 429 lesson); `_siCollectionsLoaded` is kept as the all-four flag. Permission and timeout are never auto-retried, a 429 waits 10s and retries once, cap 3 attempts. The overlay host `#si-load-host` is inside `_siLoadingSkeleton`; the card is built once and painted by targeted writes (`siPaintLoad`), so the animation never restarts on a stage change. A `window.showPage` wrap cancels everything when leaving, and the 1s tick notices a page left by any other route. **Known limits:** the stock-history read has no countdown retry; after a 90s timeout a manual retry can overlap the original slow read (it assigns its data if it lands first); the percentage weights are unmeasured. `tests/shopify-progress.test.js` (106, fake clock, per-collection read counts, 22 reverted rules). Not seen on a real screen or phone.

### Inventory Intel ▸ Article Explorer (30 Sept 2026)

Tab after "SKU Table" (`_siSection==='explorer'`, `_siArticleExplorerSection()` in `js/shopify.js`, styles `.si-ax-*` and tokens `--si-s0..s4` in `css/main.css`). Sub-tabs **Search** (one article) and **Compare** (2–5). **No new Firestore reads** — it uses `_siLineItems`, `_siProducts`, `_siSnapshot`, `_siWeeklyCloses` already loaded (`tests/shopify-article-explorer.test.js` counts reads: 0).

- **An "article" is the SKU prefix** (`GST073-S` → `GST073`), indexed once per data load (`_siAxIndex`, cached on array identity; weekly/monthly buckets cached per article). Search = every word must appear in code / title / colour / category / SKUs; debounced 150ms, only the result list repaints. Ignores the season filter (says so on screen).
- **Same rules as Sold since live:** refunded line items excluded; coverage caption "Data counted from <earliest synced order>" on every view, plus a per-article warning when its live date is earlier. Days are the first 10 chars of the offset timestamp, calendar maths on UTC day numbers (`_siAxDayNum`), weeks start Monday. Null = not live / before coverage, never a zero.
- **Metrics offered (verified: line items carry `price` and `quantity`, `netlify/functions/shopify-order-sync.js`):** units per week, per month, revenue per week, per month (unit price × qty, before discounts), cumulative units. **Stock over time is NOT offered:** the client reads only two snapshot documents (today, a week ago), not a history; offering it would need a new multi-read.
- **Since launch** aligns by live date (catalog `published_at||created_at`), falling back to the first counted sale (noted on screen); orders dated before the live day fall into week 0. Weeks before the first synced order are gaps.
- **Chart:** HTML text, SVG holds only `<path>`s (no `<text>`/`<title>`), monotone cubic curve (`_siAxCurve`, never overshoots), axis ported from `mktAxisScale`, each series has a colour token, a dash and a numbered badge. Tooltip via `_siAxHover`. A table always sits under the chart. Five-article cap refused with a message (`_siAxTryAdd`).
- Weekly close: only shown where the article is a close's `top_sku` (closes store nothing more per article).
- **Not seen on a real screen**; rendered in headless Chromium only. Hover/tap tooltip is untested in a browser.
- **Exposure-aware measures and the scorecard (30 Sept 2026, branch `claude/affectionate-volta-1dtjzy`):** ten headline metrics with formulas, "Use it for" lines and limits are in **`docs/UNITS_METRICS.md`** (net units, units per live week, sell-through of available units, in-stock rate, units per in-stock day, stock-out days, weeks of cover, momentum, share of category, age-normalised curve) plus a Performance scorecard (Winner / Healthy / Stock-constrained / Slow / Dead stock / Too early; thresholds are defaults in `_SI_AX_SCORE`, printed on screen, not facts). **The Explorer now does ONE bounded read on open** (`_siAxEnsureHistory`: newest 150 `shopify_inventory_snapshots`, cached per session, never rejects, Retry on error); 128 docs exist (26 May–30 Sept, no gaps — verified by QA REST list). Live-data rules: voided AND refunded lines excluded (other tabs exclude refunded only), negative stock clamped to 0, no-SKU items skipped, duplicate SKUs summed, receipts inferred only when ≥ max(5, 10% of opening), a supporting figure only. **Sell-through = sold ÷ (sold + stock left at the end of the span)** (30 Sept 2026): the older sold ÷ (opening + received) exceeded 100% for 65 of 339 articles because increases under the noise floor were left out of supply (evidence in `docs/UNITS_METRICS.md`). The 'August 2× normal, cause unverified' caveat was wrong: 11,166 of August's units were the sub-Rs-1 tip SKU, now excluded; merchandise units per month are flat. "Read this" is ONE block (a card per article in class order, then 'Across these articles' by topic). `published_at` is absent on every product: age/launch uses the first counted sale and says "first sale". Not computable: refund rate, discount depth, true receipts. `tests/shopify-metrics.test.js` (hand-computed fixture, 7 breaks verified).
- **Cleaning layer, sorting, voided/refunded, non-merchandise (30 Sept 2026, merged onto the exposure build):** `_siClean` (one block in `js/shopify.js`) is the ONE place the Explorer's rows are cleaned, run once per data load from `_siAxIndex` and again (stock only) for the prior-day snapshot: refunded / voided / cancelled-order / repeated / no-SKU / bad-date line items left out, negative stock clamped to 0, duplicate SKUs summed, SKUs whitespace-stripped and upper-cased, category spellings merged (blank = Unknown); `_siAxCode` delegates to it. Counts are in the **Data quality** expander (`quality`, truthful: nothing is dropped unreported). **Non-merchandise is decided by the data, not a name:** a code whose every priced sale is under Rs 1 is left out of the article list, metrics, category shares and scorecard (real dump: `TIPQUIK-TG` "Tip/Gratuity", one line of 11,000 units at Rs 0.01; a line with no price is not evidence). **Voided and refunded units** are kept aside per day (`cl.excluded`) and reported per article in the counted window (`voided`, `refunded`, `voidRate` = voided ÷ (net + voided + refunded)) in the Search tiles and the Compare "Shape and context" table; they never enter net units, sell-through, pace or cover; later voids/refunds are not synced so both understate. The SKU table's 7D/30D columns still exclude refunded only (voided rows still counted there; an owner decision). **Sorting:** `_siSort*` (comparators + `_siSortTable` click-to-sort headers with `aria-sort`): codes natural, sizes garment then waist then other, categories units desc, classes Winner, Healthy, Stock-constrained, Slow, Dead stock, Too early, Not rated; missing values always last; used by the search list, scorecard class table, compare/pace/shape tables, size table, weekly and bucket tables. **Two SKU-table sort fixes** (grouped Sell-Thru and Suggested columns now sort by their real value; Days Left descending keeps a no-rate group last). Enter in the search box picks (Search) or adds (Compare) the top match and focus stays in the box; comparison codes that vanish on reload are pruned; sales dated before the catalog live date stay on the calendar chart (`_siAxLiveDay`); touch does not hide the chart tooltip. Tests: `shopify-clean`, `shopify-sort`, `shopify-explorer-merge`, `shopify-metrics`, `shopify-article-explorer`.
- **Needs Attention rebuilt, Selling Patterns removed (1 Oct 2026, `claude/affectionate-volta-1dtjzy`):** ONE flat ranked list of articles in three bands (Critical / Act this week / Watch), caps 5/8/5 with "Show all N", uncapped counts shared by the headline, the red tab pill (critical + act, `--count-accent` with literal white) and the two Overview tiles (`_siNaState` is the single source; the old tiles read a list sliced to 8 while the true variant counts were 88 and 103, and their red/amber border never painted because `style` sat inside `class`). Clicking a row opens a situation view in place (`_siNaPlaybook`: situation, owners, what not to do, confidence; Back, Esc, Prev/Next, scroll and band state kept). Built on the Explorer helpers, no second calculator; trust strip reads `_siSyncMeta` (the loader now also reads `shopify_sync_meta/order_sync`) and the history. Rules, thresholds and the choices where plans disagreed: `docs/UNITS_METRICS.md` §3b. Selling Patterns (tab, section, `_siByNormDim`, `_siByCategoryLive`, `_siSizeCurve`, `_siNeedsAttention`) is deleted; an unknown or stale `_siSection` renders Overview (`_siSecId`). The page now starts the one bounded stock-history read when it opens (the pill needs it). Fixed in passing: the history read's 90 s timeout timer was never cleared. Tests: `tests/shopify-needs-attention.test.js` (hand-computed 20-article fixture, 42 revert checks), four `smoke-layout` fragments. **Not seen on a real screen**; lead times are defaults; no cost price exists, so cash is at selling price; the `order_sync` meta doc name was read from the function, not from live data.
- **Stock-history read cost, load-time stage 1 (1 Oct 2026, cache v289):** the 150-snapshot read (~36 MB) is NOT capped or split — every history figure reads the whole counted window (measured: a 60-day cap changed 278 of 386 articles and 53 classes; consumer map in `docs/UNITS_METRICS.md`). Instead each closed day is folded once and cached per device (`groovy-si-histfold`, days up to two days ago, 7-day expiry, Retry = full read); a warm visit reads only the newer days (2 documents instead of 128) and builds the identical history (`_siAxHistoryFromFolds`; the old build is kept as the reference in `tests/shopify-history-cost.test.js`). Warm: the read starts with the page load; cold: after first paint. Pending shows "Stock history: loading…" and "…", never 0. Not seen on a real screen; network time not measured.
- **Ignore, a shared list (1 Oct 2026, v290 — product-data sub-phase 1 of 3; details in `docs/UNITS_METRICS.md`).** `inventory_article_meta/{CODE}`: any signed-in user may write (rules `signedIn()`, which excludes the QA account; QA reads via `isQaRead()`), `updatedBy`/`ignoredBy` bound to the email prefix, field allow-list = `_SI_META_FIELDS` (held equal by `tests/shopify-ignore.test.js`), no delete (Restore is an update). **`firestore.rules` CHANGED in its own commit — it needs a REPUBLISH; until it is published every Ignore write is refused, rolled back and says so, and reads are refused too (the page then shows "Ignore list could not be read" and hides nothing).** One predicate `_siIgnored`; every list/count/pill/portfolio reads `_siAxLive()`; the four places that keep the full list are held by a test. Emulator: 8 cases in `tests/rules-emulator.js` (QA refused, foreign updatedBy refused, bad enums refused, delete refused), each rule reverted once and caught. Nobody has used it on a real screen.
- **Phase 0/1 rebuild, local only (30 Sept 2026, `claude/affectionate-volta-1dtjzy`, not pushed):** (1) **metric fixes** — headline pace is the in-stock pace when the article was in stock on < 90% of measured days; weeks of cover is a recency-weighted (12 weeks, half-life 4) in-stock pace shown as a 95% Poisson range, top end capped ("more than 26 weeks"); momentum says Rising/Fading only with 20+ units and a gap bigger than chance (else "too few sales to tell"); share of category is over the last 28 days; snapshots are re-keyed by `snapshot_at` (before 18:00 PKT is the previous day's close; two documents for one closing day keep the earlier; the sell-through span bridges one missing day). Missing inputs show "—", never 0. (2) **Classes v2** — Winner / Solid / Steady / Slow by percentile of units per in-stock day among similar-age articles (fixed bands when a pool is under 30), plus Stock-constrained and Dead stock; sell-through no longer classifies; each row has a "why" (rank, floors, nearest boundary) and an action (`_siAxActionOf`: Reorder now, Stock-out risk, Hold, Stop / clear, Stuck, Mark down, Review). **Lead times are editable per-device defaults** (tees/tops 21 days, hoodies/jackets/denim/bottoms 35, else 28; `localStorage['groovy-si-leadtimes']`), labelled "default, unconfirmed"; **no real lead time exists anywhere in the app** (plan 06). (3) **Overview** is the default tab (four action tiles, lists of 10, Open / + Compare); the article page is verdict first, six headline tiles, chart, sizes, everything else collapsed; Compare holds 3 on a phone (≤ 600px), 5 otherwise. Full rules: `docs/UNITS_METRICS.md` §3. Tests: `tests/shopify-plan5.test.js` (hand-computed 42-article fixture, every rule reverted once and caught by name). **Verified:** node tests, `SMOKE_LAYOUT_ONLY="inventory intel"`, headless Chromium renders (docs/ui-preview, untracked). **Unverified:** the percentile model against real data (plan 04 measured an earlier draft on the real 386 articles; this build was not re-run on the live dump), that 18:00 PKT matches the snapshot schedule, any real-screen look, and whether the lead-time defaults are right. Not built from the plans: ABC × XYZ badges, composite score, stored class hysteresis, stock timeline, size/colour and cohort views.
- **Needs Attention reasons, clickable bands and Overview tiles (1 Oct 2026, cache v288, branch `claude/affectionate-volta-1dtjzy`):** the headline's critical / this week / to watch are buttons that isolate a band (all rows, one-shot flash, again to restore); the filter row is now REASON chips in severity order (Urgent restocks, Sales loss, High return rate, Overstocked, Dead stock, Demand shifts), each count being the list's length (`_siNaReasonList`, one source); "Data" and "Cash tied up" are no chips (the detection, trust strip and the Overview cash tile's `cash` union stay). Sales loss reuses the Portfolio's per-article stock-out estimate (`_siAxPfLostOf`, 5+ units in 90 days, labelled estimate). **High return rate** (refunded / (net + refunded) over 90 days; 20+ units, 15%+, 2x the catalogue median, a gap bigger than chance; act at 25%) lists only when returns are synced; **on the real dump of 30 Sept no line item carries `status_synced_at` or `refunded_quantity`, so returns are NOT synced and the chip reads "waiting for returns sync" with "—"** (the quiet returns note stays). New playbooks: sales loss, high return rate, top seller. Overview tiles gained a meaning line and every row a Situation button that opens the same situation view (Back, Prev/Next, Esc); tile counts and the lead-time control are unchanged. Rules and defaults: `docs/UNITS_METRICS.md` "Needs Attention: reasons, bands and clickable Overview tiles". Tests: `tests/shopify-na-reasons.test.js` (hand-computed returns fixture, 28 reverts); three `smoke-layout` fragments. **Not seen on a real screen; the returns rule has never run on real refund data.**
- **Compare cues, Calendar fix, previous year, winter (1 Oct 2026, same branch, cache v279):** see `docs/UNITS_METRICS.md` §3a. In short: a CSS-class hint pulse (3 cycles) on the article page's "+ Compare" and the Compare tab until Compare is opened; a SKU-table product row opens its article (`_siSkuOpen`, code via `_siAxCode`, 250 ms entrance class, table state and scroll kept; the ▶ arrow still expands); exactly 1 chosen = red `--count-accent` badge on the Compare tab plus an alert shown at once, 1.5 s, 250 ms fade, then removed (one at a time, no focus, "up to 3" on a phone); **the Calendar "not working" report could not be reproduced as an error** (real Chromium, live dump, 332 articles x 8 metrics: no throw, lines drawn) — it was a default basis whose chart sat below the scorecard, so the chart is first now and a basis press scrolls to it and outlines it; calendar options: previous-year overlay (missing is never 0, data starts 26 Mar 2026 so none exists before 26 Mar 2027), Winter (Oct–Feb, leap-aware) window and Month by month tiles with winter frost (`--si-frost-*`, dark partner). `tests/shopify-explorer-calendar.test.js` (107, 32 break checks); three `smoke-layout` fragments. Not seen on a real screen.
- **Article pictures and rolling months (1 Oct 2026, cache v282):** see `docs/UNITS_METRICS.md` §3b. One helper `_siAxImage`/`_siAxThumb` (anchored `cdn.shopify.com` https only, used as stored, never resized: the width parameter was not verifiable here; code tile on none or on error via `_siAxImgFail`; span is `data-th`, never `data-code`). Coverage on the real dump 386/386 articles. Compare > Month by month is now a rolling window ending at the current month (first synced month to now, latest 12, stepper `_siAxMonStep`; no future/pre-data tiles); `_siAxWinYear` is only the winter window's now. Tests: `shopify-article-images`, `shopify-explorer-calendar`. Not seen on a real screen (headless Chromium over the real dump with a stand-in picture, because the sandbox cannot reach the CDN).
- **Per-article lead time (30 Sept 2026, same branch):** `_siAxLeadTime(a)` is the ONE reader: article override (`localStorage['groovy-si-leadtimes-article']`, CODE -> whole days 1..365, per device, no Firestore, no rules change) -> category default -> global fallback 28; it returns `{days,custom,article,source,text}` and the action sentence uses `text` ("your lead time for this article" vs "default lead time, unconfirmed"). UI: `_siAxLtCtlHtml` ("Lead time: N days · Edit", inline input, Enter saves, Escape cancels, Reset to default, a "custom" chip) on the verdict and every Overview row; `_siAxLtRepaint` repaints the explorer body only, keeps scroll and refocuses the row's Edit button; overrides are listed in the lead-time panel with Reset. Codes travel in `data-code`, never in handler strings. Overrides are per device; sharing them would need a Firestore collection and a rules republish. `tests/shopify-leadtime-article.test.js` (49; 15 reverts caught by name); layout fragments `… overview lead time editor` and `… verdict lead time editor`. **Not seen on a real screen.**

- **Stock vs sales timeline, phase 2a (1 Oct 2026, branch `claude/affectionate-volta-1dtjzy`):** a card on the article page (`_siAxTlCardHtml`, styles `.si-tl-*`), two stacked panels on one x axis: stock on hand as a stepped area, out-of-stock stretches as a hatch with an "Out N d" label, units sold as bars (striped when sold at zero stock), inferred restock triangles, a lead-time marker and a read-out list that is always above the chart, with a stretches table and a collapsed numbers table below it. Day/Week and 30/90/All toggles (`_siAxTlSet`, per page view, not stored). **Rules and the lost-sales estimate: `docs/UNITS_METRICS.md` §3c** (estimate uses only the in-stock pace, one-sided range is a stated assumption, stretches over 42 days not estimated). All text is HTML, SVG holds paths only; tokens only. `_siAxBuildHistory` now also returns `neg` (per-code per-day count of negative variants, clamped to 0 in the sum) and `loc` (location boundary). **No new Firestore read.** `tests/shopify-timeline.test.js` (hand-computed fixture, 18 reverts each caught by name); layout fragment `inventory intel — Article Explorer stock vs sales timeline`. This supersedes the earlier line "Stock over time is NOT offered". **Not seen on a real screen** (headless Chromium over the 30 Sept dump, docs/ui-preview/timeline-*). Phase 2c (portfolio) is built (see below).
- **Sizes card, phase 2b (1 Oct 2026, cache v283):** a card below Stock vs sales (`_siAxSizesCardHtml`, styles `.si-sz-*`): per size on hand, a week ago, sold 28 d and counted, the sales curve against the stock curve as two aligned HTML bars, cover per size, a status chip (glyph + word), a one-line readout (`_siAxSizeReadout`) and a suggested split of the next batch (`_siAxSizeSplit`, a suggestion, not an order). Pure cores `_siAxSizePanelCalc`, `_siAxSizeCurve` (shrinkage K=6), `_siAxRoundShares`; states reuse `_siNaSizeRows`, the batch total reuses `_siNaQty` (no second reorder calculator). **Rules, defaults and the colour decision (not split: an article is one colour): `docs/UNITS_METRICS.md` §3d.** Thin uses the Needs Attention 14 days, not 7. No Firestore read. `tests/shopify-sizes.test.js` (63, 18 reverts each caught by name); layout fragment `inventory intel — Article Explorer sizes card` (phone: each size is a labelled card, the table stays in the markup). **Not seen on a real screen** (headless Chromium over the 30 Sept dump, docs/ui-preview/sizes-*).
- **Portfolio, phase 2c (1 Oct 2026, cache v284):** a sub-view `Portfolio` beside Overview/Search/Compare (`_siAxPortfolioBody`, pure core `_siAxPfCalc`, `_siAxPfReadout`, state `_siAxPf*`, styles `.si-pf-*`): readout paragraph, six tiles, class mix (three stacked HTML bars + table), category table, season table (Oct-Feb winter by order month; an article is a winter seller only above half its units), concentration (articles for 50/80% of units and revenue, top 5/10/20, ranked list), cash tied up in dead/slow/over-stocked vs winners (value at selling price, not cost), stock-out exposure (sum of the timeline's own estimates over 90 days, labelled an estimate), and a filterable ranked table plus scatter (cover vs units per in-stock day) that opens the article. Only existing indexes, cached per data load, no Firestore read. **Rules and defaults: `docs/UNITS_METRICS.md` §3e.** `tests/shopify-portfolio.test.js` (98, 23 reverts each caught by name); layout fragment `inventory intel — Article Explorer portfolio` (it caught an invisible Not-rated glyph at 1.4:1). **Not seen on a real screen** (headless Chromium over the 30 Sept dump, docs/ui-preview/portfolio-*; build over 386 articles about 0.5 s once, then cached).
- **Compare flow and the navigation search box (1 Oct 2026, cache v285):** Afnan's ask, as read: in Compare you search, press "+" and each chosen article lands at once as a picture card in a "Selected (n of max)" tray (`_siAxTrayHtml`, `_siAxCardHtml`: 64px picture, title, code, class chip, remove ×; max stays `_siAxMaxCmp()`, 5 or 3 on a phone); you keep searching (focus stays in the box, Enter adds the top hit); results already chosen read "✓ Added" (`aria-pressed`) and every result row carries a 40px picture; with two or more chosen a primary 44px **Compare →** (`_siAxGo`) scrolls to and outlines the comparison (`#si-ax-result`); with one chosen the badge and 1.5 s alert are unchanged. The search box is navigation, so it is ONE builder (`_siAxSearchBarHtml`) on every sub-tab (Overview, Portfolio, Search, Compare): 52px, 2px token border, 3px focus ring, magnifier SVG path, "Find an article" placeholder, sticky (`top:0` in `#main-content`, z 20, under the app bar's 100), results capped at 48vh; on Overview and Portfolio a result opens the article page. "/" focuses it (`_siAxSlashOk`, one document listener wired once, ignored while typing in a field, with Ctrl/Meta/Alt, or off the Explorer). Reuses `_siAxSearch`/`_siAxResultsHtml`; no second search, no Firestore read. `tests/shopify-explorer-compare-flow.test.js` (56, 17 reverts each caught by name); layout fragments `…compare tray and search`, `…compare tray at the maximum`. The old chips (`.si-ax-chip`) are gone. **Not seen on a real screen** (headless Chromium over the 30 Sept dump, docs/ui-preview/flow-*); the sticky offset under the app bar and the phone keyboard are unmeasured on a device.

## Shared touchpoints — coordinate before changing

These functions/blocks are edited by both tracks. Check the other branch
before pushing changes here. **`index.html` and `js/shared.js` are the
cross-track files — both tracks must coordinate on any change to these two
specifically**, since they hold the shell, the router, and the nav:

- `buildNav()` — lives in `js/shared.js` (the router/nav code); the nav DOM
  containers are wired in `index.html`. Both tracks add nav items here
- `renderPage(id)` switch — lives in `js/shared.js`; both tracks add page
  dispatch cases here
- `loadPrintingData()` (`js/embellishments.js`) / `loadHRMData()`,
  `loadHRMSession4Data()`, `loadPayrollData()` (`js/hrm.js`) /
  `loadBugReports()` (`js/shared.js`) — be careful with order
- `css/main.css`, especially the `@media (max-width: 600px)` block
- `_icon(name, size)` SVG set (`js/shared.js`) — add new icons not reuse
- `openMobSheet({title, items})` (`js/shared.js`) and the More-sheet list
- `:root` CSS variables in `css/main.css` — accents (`--accent-urgent`,
  `--accent-warning`, `--accent-success`) and radii (`--radius-card`,
  `--radius-bubble`)
- `window.__bootApp()` in `js/shared.js` — the 5 hoisted load-order blocks;
  do not move these back inline
- `sw.js` — the `PRECACHE_URLS` list must gain an entry whenever either
  track adds a `/js/*.js` or `/css/*.css` file, and `CACHE_VERSION` must be
  bumped on any shipped HTML/CSS/JS change. See "PWA / offline caching"

## Permission helpers

Username-gated (not just role-gated). The HRM-ops ones (`_canViewPayroll`
etc.) live in `js/hrm.js`; the printing/role helpers (`isObserver`,
`isPrintWorker`, `isQCWorker`, `canManageRecipes`, …) live in `js/auth.js`:

- `_canViewPayroll()` → afnan, ammar, mustafa
- `_canProcessPayroll()` → afnan, ammar — running/processing a WHOLE MONTH
  for every employee, or marking a whole month paid. Stays owner-only.
- `_canManagePayslips()` → afnan, ammar, mustafa (Sept 2026 grant) —
  individual payslips only: override one value, mark ONE person paid.
  Deliberately narrower than `_canProcessPayroll` — mirror in
  `firestore.rules` `payslips` write.
- `_canViewHRMOps()` → afnan, ammar, mustafa (advances/loans/policy)
- `_canApproveHRMOps()` → afnan, ammar — **advances only** (approve/reject/
  mark paid). Do not widen this for loans; use `_canManageLoans` instead,
  or Mustafa also gets advance-approval power that was never asked for.
- `_canManageLoans()` → afnan, ammar, mustafa (Sept 2026 grant). Loans have
  no separate pending→approved step (`loanSubmit` creates one straight into
  `'active'`) — so this covers create/pause/resume, i.e. "approve a loan"
  in this app's actual design. Mirror in `firestore.rules` `loans` write.
- `_canEditPolicy()` → afnan, ammar
- `_fabCanDelete()` (`js/fabric.js`) → afnan, ammar, **mustafa by username**
  (Sept 2026 grant) — delete/edit/correct a fabric entry or roll. Mirror in
  `firestore.rules` `isMustafa()`, used on `fabricin`/`fabric_inventory`
  delete.
- `_profCanEditUser(username)` / `_profCanResetPassword(username)`
  (`js/profile.js`) → afnan, ammar, mustafa may edit other people's
  profiles; **mustafa may not edit afnan's or ammar's**. Mirrored in
  `firestore.rules` `user_profiles` update and in
  `netlify/functions/admin-reset-password.js` (`RESET_ADMIN_EMAILS` /
  `PROTECTED_EMAILS`) — three layers, see "Admin profile editing".
- `canAccessMarketing()` / `isContentOpsLead()` / `canApprovePaidPR()`
  (`js/auth.js`) → The Sales Team ▸ Marketing. Access is by ROLE (owners +
  `creator_content_ops_lead`); Paid PR approval is the per-account
  `canApprovePaidPR` flag on `USER_DEFS` (Ammar today), NOT a username and
  NOT a role — both owners share `owner`. Mirrored in `firestore.rules`
  (`isMarketing()` / `isContentOpsLead()` / `isPaidPRApprover()`, by
  email — moving the flag means moving the email too). See "The Sales Team ▸
  Marketing".
- **CSR Team Lead** (`csr_lead`, Sami — `sami@groovy.op`, added 17 Sept
  2026). `isCsrLead()` / `CSR_LEAD_PAGES` in `js/auth.js`. Scoped in
  `showPage` to Dashboard, QC Disposition, B-Stock, Fabric Inventory,
  Inventory Intel and Creative Hub (plus the hub's notes/boards pages and
  `_CHROME_PAGES`); anything else lands on the dashboard. **View only by
  design** — customer support reads these pages, it does not run them: the
  dashboard drops the PO list (it opens PO pages the role cannot reach),
  `_qcCanRecord()` hides and refuses both QC write actions, `_fabReadOnly()`
  hides the Fabric In / Issue / Drawstrings / Returns tabs, and B-Stock's
  existing `canAssign`/`canTransfer` already exclude the role. `canFabric`
  is true so the fabric low-stock card shows on his dashboard. **No
  `firestore.rules` change** — every collection those pages read is
  `signedIn()`, so like every other role scope here this is an app-layer
  limit. The login email was given as `sami@groovy.ops`; every account is
  `@groovy.op` (and `admin-seed-profiles.js` accepts only that domain), so
  `@groovy.op` was used — **the Firebase Auth account must match it
  exactly** or login fails. `tests/csr-lead.test.js`.
- `_acctCanView()` / `_acctCanEntry()` / `_acctCanAdmin()` (`js/store-accounts.js`)
  → view: owners + managers + `store`; entry: owners + `store` (Raees);
  admin: owners. `_canViewCash()` is kept as an alias so `js/shared.js`'s
  four nav sites did not change name. Mirror: `firestore.rules`
  `isStoreAccounts()`.
- `_acctIsSuper()` (`js/store-accounts.js`, `_ACCT_SUPER_USERS`) → **afnan
  + ammar by username** (Ammar added 25 Sept 2026) — edit an entry in place,
  delete one, delete a vendor with no entries, reopen the last closed
  month, reset the module. Mirror: `firestore.rules` `isAcctSuper()`. See
  "Afnan's correction tools" under Store Accounts.
- `_acctEditBlock(e)` (`js/store-accounts.js`) → who may edit which entry:
  Raees (`store`) his OWN posted, unreviewed entries in an open month;
  afnan + ammar (`_acctIsSuper`) anything in an open month; nobody else.
  Mirror: `firestore.rules` `acctOwnEdit()`. See "Raees can EDIT".
- `whsCanView()` / `whsCanEntry()` (`js/warehouse-sales.js`, `_WHS_USERS`) →
  **umair by username + the owners by role** — the Accounts section on the
  fulfillment page (warehouse customer sales). Managers see the page, not
  the section. Mirror: `firestore.rules` `isWhSales()`.
- `_storeIsSuper()` (`js/store.js`, `_STORE_SUPER_USERS`) → **afnan + ammar
  by username** (25 Sept 2026; was four hardcoded `session.u==='afnan'`
  checks) — the Store Dashboard's Danger Zone: full stock overwrite and
  reconstruct-from-log. App-layer only; `store_items` is `signedIn()`
  writable in the rules.
- **The Store sidebar section** (`buildNav()`, `js/shared.js`) → owners,
  managers and the `store` role — i.e. afnan, ammar, mustafa, arfat, raees.
  It used to test `!isWorker` alone, so Uzaib (a `viewer`) got the whole
  section on desktop; it is `!isWorker&&!isViewer` now (25 Sept 2026, at
  Afnan's ask). Every scoped role (packing, fulfilment, Marketing lead, CSR
  lead) returns early from `buildNav()` and never reaches it.
  `tests/store-access.test.js` drives the real `buildNav()` for EVERY
  `USER_DEFS` account, so a new account is checked by default.
- **Inventory Intel nav item** (`js/shared.js`, `buildNav()` +
  `openMoreSheet()`) → owners, **+ mustafa by username** (Sept 2026 grant,
  he's Ecom Manager). Nav-only, same shape as the Notes staged-rollout gate —
  no `firestore.rules` mirror needed since `shopify_*` collections are
  already `read: if signedIn()` for every role.
- `maCanSee()` (`js/master-accounts.js`, `_MA_USERS`) → **afnan + ammar by
  username** — every `ma-*` page, the nav section, the More-sheet entry and
  the dashboard card. Mirrored four ways (`MA_OWNERS` in `js/ma-core.js`,
  `isMasterAccounts()` in `firestore.rules` by email, `MA_OWNER_EMAILS` in
  `netlify/lib/ma-server.js`); `tests/ma-server.test.js` holds them equal.
  The rules make it a READ boundary too — the first in the app. See
  "Master Accounts".

**Sept 2026 grants share one pattern, worth knowing before touching any of
them:** each is scoped to Mustafa **by username**, not by `role==='manager'`
— Arfat holds that same role and gets none of these three. `firestore.rules`
mirrors this with its own `isMustafa()` function (not `isManager()`). If a
third person ever needs one of these, add their username explicitly on
both sides — do not switch the check to role-wide, that silently grants
Arfat everything too.

Plain role checks elsewhere:
- `session.role === 'owner' | 'manager' | 'store' | 'worker' | 'viewer'`
- Helpers: `isObserver()`, `isPrintWorker()`, `isStitchWorker()`,
  `isQCWorker()`, `isBundleWorker()`, `canManageRecipes()`, `canSeePrinting()`

## Monitor page — owner-only oversight dashboard

`js/activity.js` — page id `monitor`, nav item next to Activity Log and
Users (`js/shared.js`: `renderPage` dispatch, desktop `mainItems`, mobile
`groups` map, mobile More-sheet, `BUG_PAGE_NAMES` — same four touchpoints
every owner-only page needs, see "Shared touchpoints"). Rebuilt Sept 2026
per a 10-question spec round with Afnan; the brief version (flat per-person
list, no filters) shipped first and was replaced same week — this is the
real one. Reads the same `activity` collection Activity Log reads, fetched
once per `loadMonitor()` call: `orderBy('ts','desc'), limit(_MONITOR_FETCH_LIMIT)`
(1000) — deliberately a single-field query with no `where()`, so it can
never hit a missing-composite-index error; ALL filtering (date range,
search, person) happens client-side on that fetched set. If a selected
range's start predates the oldest fetched item, the filter bar shows an
honest "may be incomplete" note rather than silently under-counting.

**Two views, one state machine** (`_monitorPerson` null = overview, a
display name = drilldown into that person; `_renderMonitorPage()` picks
based on it — every `window.monitorX()` handler mutates state then calls
this, same full-innerHTML-rerender pattern as the rest of the app):

- **Overview** — stat tiles (actions in range / active accounts / watched
  count), a pinned "⚠ Recent watched activity" panel pulling flagged rows
  out of the noise regardless of whose card they'd otherwise be buried in,
  then every person as a clickable summary card (category chips, watched
  count if any) grouped into three role tiers — Owners / Managers /
  Everyone else (`_monitorRoleTier`, reads `USER_DEFS` from `js/auth.js`,
  loaded before `activity.js` — matches by the activity doc's `a.user`
  display name, not username, since that's the only identity `logActivity`
  writes).
- **Drilldown** — one person's log, still honoring the active date filter,
  grouped into category sections. Logins collapse into a single "N
  sign-ins · last …" row (`window.monitorToggleAuth`) instead of one block
  per login — the exact problem that made the first version unusable
  (Uzaib alone had 99 rows, nearly all logins). Every other entry starts
  collapsed to one line, click (`window.monitorToggleEntry`, tracked by
  Firestore doc `_id`) expands it to show the detail + timestamp.

**Date filter:** `_monitorFilter={preset,from,to}` — Today / This Week /
This Month / All Time / Custom. Custom uses two native `<input type=date>`
(no calendar-picker library — consistent with this app's zero-new-deps
policy) applied via `window.monitorApplyCustom()`.

**Search:** debounced 180ms + refocus-after-rerender
(`window.monitorSearchInput`) — the exact pattern already used by
`fabInvSetSearch` etc. in `js/fabric.js`; copy that pattern for any future
search input in this codebase, not a fresh one. Searches person names in
overview, action/detail text in drilldown.

**Categories** (`_MONITOR_CATEGORIES`, ordered — order matters, first
match wins): Sign-in, Delete, Approve/Money, Edit, Create, Process
(fallback). Each has a color + emoji icon used for the chips on overview
cards and the section headers in drilldown, so the page scans visually
without reading every line. The exact regexes were validated against every
real `logActivity()` action string in the codebase with a throwaway node
script before shipping (not guessed) — "Approve/Money" is checked BEFORE
"Edit" specifically so `Edit request approved`/`rejected` land with the
other approvals, not misfiled as a plain edit. If a new `logActivity()`
call is added anywhere with a genuinely new verb, sanity-check which
bucket it falls into (`_monitorCategorize`) rather than assuming.

**Red-marker flagging:** `_MONITOR_WATCH_ACTIONS` is the exact set of
`logActivity()` action strings tied to Mustafa's Sept 2026 grants — fabric
delete/edit/correct, loan create/pause/resume, payslip override/mark-paid.
A row/card gets flagged only when `a.user===_MONITOR_WATCH_USER` ('Mustafa')
AND the action is in that set — deliberately not "every owner-level action
by anyone." If another grant like this happens later, add its action
string(s) here and widen `_MONITOR_WATCH_USER` to an array if watching more
than one person (it's currently a single string, several places assume
that).

**Dashboard widget:** `renderMonitorDashboardWidget()` — a compact card
(today's watched count + active-account count, click-through to Monitor),
injected into the owner's home Dashboard. Follows the exact existing
`renderHRMDashboardWidget` pattern: a synchronous placeholder returned by
`renderDashboard()` in `js/embellishments.js` (guarded with
`typeof===...==='function'`, since embellishments.js loads before
activity.js — same reason the HRM one is guarded too), populated
asynchronously by `_monitorPopulateDashboard()`, hooked into the
`id==='dashboard'` dispatch in `js/shared.js` via `setTimeout(...,0)`
alongside `_hrmPopulateDashboard` / `_fulfillDashboardInject`. There are
five such widgets now — HRM, Monitor, Marketing, Pattern Hub and Master
Accounts (verified 29 Sept 2026; the dispatch line also carries
`_fulfillDashboardInject`). Adding a sixth means a sixth `typeof` guard in
`renderDashboard()` and its own `setTimeout` in that same dispatch line —
do not skip either half, or the placeholder renders and never populates
(or worse, never renders and the populate function's `getElementById`
silently no-ops).

**Fetch timeout (Sept 2026):** both `loadMonitor()` and
`_monitorPopulateDashboard()` race their `getDocs()` call against
`_monitorWithTimeout(promise, 12000)` — 12s, then a real error state (a
Retry button on the full page; a "Taking too long — Retry" link on the
dashboard widget) instead of an indefinite "Loading…". Added after Afnan
reported Monitor stuck on "Loading…" with a stuck "Saving…" overlay
elsewhere on the same dashboard at the same time.

Investigated and ruled out before writing this fix — recorded so a future
session doesn't re-walk the same dead ends: `sw.js`'s `BYPASS_HOSTS` is
correct (the generic `googleapis.com` entry's `endsWith('.' + host)` check
already covers every Google API subdomain — `firestore.`, `identitytoolkit.`,
`securetoken.`, not just `firestore.googleapis.com` itself — so the SW was
not intercepting Firestore traffic); the `__bootApp()` write/read wrapper
around `setDoc`/`getDocs`/etc. (`js/shared.js`, "Auto-wire the global
loaders") correctly calls `stop()` on both the success and failure branch
of every wrapped call. **Neither of those had a bug.** The most likely
real cause is `persistentMultipleTabManager`'s IndexedDB lock getting
stuck if a previous tab/window of the app didn't close cleanly — a known
failure mode of Firestore's persistent local cache, not something we can
fix on the client side beyond "close other tabs and reload," which is now
literally what the timeout message tells the user to try.

**Deliberately not touched:** the shared `showLoader`/`_gvWriteStart`/
`_gvWriteStop` write-buffer system (the "Saving…" overlay) that raised the
second symptom. It already has its own 25s failsafe
(`_gvBufTimer` in `showLoader`, `js/shared.js`), so a single stuck promise
should self-clear on its own — a still-stuck state past that would need
something re-triggering `showLoader` repeatedly (a retry loop), which
wasn't reproducible from code alone. This is pre-existing, heavily-shared
infrastructure that every save operation in the app depends on; patching
it from a hypothesis risks breaking real saves everywhere. If it recurs,
get the browser console output from the moment it happens before touching
this code.

## Cutting / Issue Registry — the cut-date filter (Sept 2026)

`PO Registry → Cutting / Issue Registry` (and the same card under Fabric
Inventory — one function, `renderFabricIssueRegistry()` in `js/fabric.js`,
mirrored into both). Afnan asked for a date filter "so it is easy to assess
what got cut on what date". Presets All / Today / Yesterday / Last 7 days /
This month / Custom, the same shape as Monitor's `_monitorFilter`.

- **It filters on `g.date` — the same string the card prints — not on `ts`.**
  `ts` is the creation time; `date` is the cut date, and Edit can change it.
  Filtering on the displayed value is what makes the filter incapable of
  disagreeing with what is on screen. A record with no `date` falls back to
  its `ts` day (`_fabRegDayOf`); one with neither is excluded from a bounded
  range — it cannot be *proved* to sit in it — but is never hidden from All.
- **Bounds are inclusive YYYY-MM-DD strings compared as strings**
  (`_fabRegDateBounds`), so there is no Date maths per row. `_fabRegDayStr`
  builds a **local** day; `toISOString()` is UTC and in PKT (UTC+5) names the
  previous day before 5am.
- **Default is All, not Today.** This is a historical record, not a feed —
  opening onto an empty page most mornings reads as broken.
- **The stat tiles follow the ACTIVE filters** (`_fabRegStatsHTML`, repainted
  by `_fabRegRepaint` on every filter change, not on paging). Headline totals
  that still counted every issue ever cut would answer the wrong question,
  which is the whole reason the filter exists. The caption under them says
  what is being counted ("2 of 167 issues · Today").
- **`_fabRegFiltered()` sorts by DAY first, then `ts` within the day.**
  `_fabIssueRecords()` sorts on `ts` alone, so an entry whose date was
  corrected in Edit sits away from its own day and the list grows a **second
  header for a day it already showed**, each claiming the full day's totals.
  Grouping by day is only coherent if the order is by day. Undated rows
  (`''`) sort last.
- **A day header carries the whole filtered day's roll-up, not the page's
  slice** — "what got cut on the 14th" is a property of the day, not of where
  the pagination fell. Weight is **split by unit** (kg / meters); adding the
  two would be a made-up number.
- **Export Excel exports what is on screen**, filters included, with the
  range in the filename and the toast. A date filter you then had to re-apply
  in Excel would defeat the point of picking one.
- `tests/fabric.test.js` covers all of it (verified both ways: reverting the
  day sort fails the one-header-per-day check, reverting the stats scope
  fails four more). `tests/smoke-layout.js` gained a fragment for the filter
  bar and day headers — same justify-between label/number row that crushed
  the Profile directory's names to 0px.
- **The probe now skips `<option>`/`<optgroup>`.** Chromium never lays them
  out, so every option in a fragment reported as zero-size invisible text —
  a false positive that would block any fragment containing a dropdown. It
  is an **array**, not a comma-joined string: `'OPTION,OPTGROUP'.indexOf('P')`
  is 1, which would silently exempt every `<p>` in the app.

### Cutting masters beyond Hassan and Alam (Sept 2026)

Afnan, with the Issue fabric form's Cutting master dropdown circled: *"logic
to add other master names as well and the will be implemented in the pdf as
well, masters other than Alam and Hassan."* The dropdown was two hardcoded
`<option>`s in two places (the issue form and the registry's Edit form), and
**no PDF printed the cutting master at all**.

- **THE LIST IS DERIVED, NEVER STORED** (`_fabCutMasters`, `js/fabric.js`):
  Hassan and Alam first, then every `cutMaster` already on a fabric issue
  (`_fabIssueRecords()` — `allPasses` is loaded whole, no limit), then any
  name added this session, A–Z, matched **case-insensitively** so `alam`
  selects Alam rather than minting a twin. **"+ Add cutting master…"** is the
  last option: a name is typed, added and selected, and it joins the list for
  everyone **the moment an issue is saved under it**. The Store Accounts
  runner rule. **A stored list was ruled out on purpose:** `settings/*` is
  `isOwner()`-write, and Mustafa (manager) and Uzaib (viewer) are the people
  who issue fabric — a settings doc would have refused them until a rules
  change was published. No `firestore.rules` change, no republish. **Known
  limit:** a name added and never used for an issue does not survive a
  reload (it has cut nothing yet), and a master who leaves stays on the list
  while any issue names them — correcting a typo'd name in Edit removes it.
- **A LIVE BUG FIXED WITH IT:** the Edit form offered only Hassan and Alam,
  so saving an edit on an issue cut by anyone else **silently wrote
  `cutMaster:''`**. `_fabCutMasterOptions(selected)` always offers the
  current value, even one on no record. `_fabCutMasterValue` is the one
  reader both saves use, and it never saves the `__new` sentinel.
- The registry search matches the cutting master too.
- **The PDF is the fabric-issue GATE PASS** (Gate Pass registry → ⬇ PDF →
  `generateGPPdf` → the engine's `gate-pass` variant) — a fabric issue IS a
  gate pass. **Cutting master takes the Purpose row's place** when there is
  no purpose, which is always true of an issue (its payload has no purpose
  field, so that row only ever printed "—"). **A ninth row was tried first
  and MEASURED to push a single-fabric issue's signature blocks onto a second
  page** (gate-guard box at y=765 of 806 → page 2). With both fields both
  print; a pass with no master prints exactly as before. The legacy
  (`__usePrintEngine=false`) fallback follows the same rule.
- **Not touched: the Pattern Hub's `_PTN_TRACERS`** (`js/patterns.js`,
  "Traced by") — also Hassan and Alam, but a different job (tracing a
  pattern, not cutting a PO) with its own hardcoded list.

`tests/fabric.test.js` drives it (+29): verified by reverting the Edit form
to two options, making the dedupe case-sensitive, saving `__new`, adding the
PDF row as a ninth row (`got 2, expected 1` pages) and dropping the search
field — each fails by name. **Nobody has picked a new master or printed the
PDF on a real screen** — the sandbox cannot sign in [29 Sept: a headless QA session can sign in and render — see "Sandbox limits"].

## Login, Remember me and the fingerprint lock (26 Sept 2026)

Afnan sent a phone mockup of the login (dark + light) and asked for the
phone logic around it: theme, saved passwords, fingerprint. `js/auth.js`,
section "Login, persistence and the app lock"; markup in `index.html`
(`#scr-login`, `#scr-lock`); `tests/login.test.js`; a `smoke-layout`
fragment `login — the sign-in screen and the fingerprint lock`.

- **A LIVE BUG FIXED WITH IT: "Remember me" never kept anyone signed in.**
  It saved the username only; the restore in `onAuthStateChanged`
  (`js/shared.js`) needed sessionStorage `'u'`, which a phone clears every
  time the installed app is closed — so everyone retyped their password on
  every open. The restore now finds the account by the signed-in **email**
  and follows the person's choice (`_authRestoreDecision`, pure, tested):
  Remember me ticked → `browserLocalPersistence` + flag
  `groovy-keep-signed-in='1'`; unticked → `browserSessionPersistence`. A
  session from the old build with no flag is kept only if the old build had
  remembered that username. `setPersistence` and both persistences are
  bridged in `index.html`.
- **THE APP NEVER STORES A PASSWORD.** "Save password" is the phone's own
  manager: the login is a real `<form>` (`autocomplete=username` /
  `current-password`, a submit button — the password field no longer calls
  `doLogin` on Enter, or the form would sign in twice), and on success, only
  with Remember me ticked, the password is OFFERED via
  `navigator.credentials.store(new PasswordCredential(...))`. A test asserts
  the password appears nowhere in app storage.
- **Fingerprint = APP LOCK, Afnan's choice over passkey sign-in.** WebAuthn,
  platform authenticator, `userVerification:'required'`; the credential id
  is kept in `localStorage['groovy-applock']` per uid, nothing goes to a
  server and the app never sees a fingerprint. It locks a kept session on a
  **cold open** (not a same-tab reload) and after **5 minutes** in the
  background. It opens only when the authenticator data's **UV bit** is set
  (presence alone is refused). It **never strands anyone**: no record, no
  WebAuthn, or an old cached `index.html` with no `#scr-lock` → straight
  in; "Use password instead" signs out to the login — **always, since
  `0a0df4b` on the Master Accounts branch (V1):** for an owner whose books
  could not come off the device it used to reload into the app, unlocked;
  now the lock stays up until the sign-out is done. `_lockDone(verified)`
  says whether a fingerprint was really checked; the app lock ignores it
  (so "straight in" above still holds) and only Master Accounts' own unlock
  acts on it (V9). Offered once per
  person per device after a Remember-me sign-in; switched in **Profile →
  Fingerprint lock**. It guards an unattended phone; it is not a login on a
  new device. **Passkey sign-in (fingerprint INSTEAD of the password) was
  the other option** — it needs a Netlify function to verify the assertion
  and mint a custom token, and was deliberately not built.
- **Forgot password?** opens a note, not an email: `@groovy.op` inboxes are
  not real, so it names who can set a new one (Afnan, Ammar, Mustafa).
- **The wordmark is cropped, not re-drawn**: the PNG is "groovy® OPERATIONS"
  on one line; `.login-mark` shows its first 448 of 744px and OPERATIONS is
  spaced text. The theme pill cycles Light → Dark → Auto and writes the same
  `groovy-theme` key Profile → Appearance does.
- **The login does not scroll (fixed 26 Sept, from Afnan's phone).** It
  was a page in the document flow under `body{min-height:100vh}`; on
  Android `100vh` is the LARGE viewport while the card was `100dvh`, so the
  document was taller than the card and the screen scrolled onto a bare
  strip. **That cause is reasoned, not reproduced** — an iframe's vh equals
  its dvh, so the sandbox cannot show the difference. `#scr-login` is now
  `position:fixed` at `100dvh` with its own `overflow-y:auto` and
  `overscroll-behavior:none`, and `html.gv-login` (added at load, removed
  in `startApp`) stops everything behind it scrolling. Measured at 390px
  wide: nothing scrolls at 844/740/667px, nor at 420/380px (keyboard open,
  where the heading, subtitle, footer and theme pill hide). **600px scrolls
  24px**, with Sign in still on screen. The first cut stretched the card to
  the layer, which squashed Sign in to **22px** with the keyboard open —
  the card is `flex-start` + `min-height:100%` and its children don't shrink.
- **The fingerprint choice is ON the login screen now** ("Unlock with
  fingerprint next time", `#login-bio`, 26 Sept). Afnan signed in twice on
  v207/v208 and never got the lock: it was only offered in a card 1.5s
  after the app opened, and that card was marked "offered" when SHOWN, so
  an unseen card never came back. **Which of the two it was is not known**
  — no log from the phone. The row shows only where
  `isUserVerifyingPlatformAuthenticatorAvailable()` says yes AND Remember
  me is ticked; ticked → `_lockEnableAfterLogin()` asks straight after
  sign-in; unticked while the lock was on → turned off. A refusal inside
  1s (Safari: WebAuthn outside a tap, no dialog shown) falls back to the
  card, whose button is a tap; a later refusal is a cancel and is left
  alone — a timing heuristic, labelled as one. The card is now marked
  offered only when ANSWERED.
- **The nitty-gritty round (27 Sept, second recording).** Read frame by
  frame; every item was real: (1) Chrome's blue **tap highlight** made the
  eye, key and Remember-me row look "selected" — `-webkit-tap-highlight-color:
  transparent` on `#scr-login,#scr-lock,.topbar`, each control has its own
  `:active` press state, keyboard keeps `:focus-visible`; (2) **Sign in
  stuck grey** — a `:hover` sticks on touch, so all login hover styles live
  in `@media (hover:hover) and (pointer:fine)` (asserted); (3) Chrome's
  **"Sign in as" list** showed blank avatars — a `PasswordCredential` can
  carry `name` and `iconURL`, so the credential is stored again once the
  profile photo is known (`_loginStoreCredIcon`, called from
  `profileApplyToSession`; the password is held IN MEMORY for ≤30s for
  that, never written). Accounts Chrome saved on its own get a picture only
  after that person signs in on the new build; (4) closing that list
  showed a red error — silent now; (5) **Forgot password** is a bottom
  sheet OUTSIDE the form, not a box that shoved the page up; (6) after the
  fingerprint the login sat still for ~1.5s — the button now says "Waiting
  for your fingerprint…" / "Signing you in…" and the rest of the form steps
  back (`is-busy`), and every sign-in FADES the login out (`_loginLeave`,
  230ms) instead of cutting; (7) the phone **top bar** wrapped "Change
  password" and pushed Sign out off the screen — below 600px it keeps logo,
  bell and avatar; **Sign out moved onto the Profile card** (the avatar),
  which already had Change password.
- **Pull-to-refresh REBUILT from Afnan's screen recording (27 Sept).**
  Read frame by frame (cv2, 90fps): every release was a hard cut to a
  blank page (brightness 42 → 12.5 in ONE frame), then the entrance
  animation replayed for ~0.8s, then the fingerprint row popped in late
  and shoved the form up. Now a pull is a CHECK, not a reload:
  `_ptrRefresh` asks the service worker for a new build and returns
  `'current'` (the ring turns into a tick, "Up to date", a double-pulse,
  the card springs home — the page never goes away) or `'update'` (only
  when a worker actually installed: "Updating…", the card fades, reload,
  and `html.ptr-return` from the `<head>` script skips the entrance so it
  reads as one screen). The fingerprint row is decided at load from the
  remembered answer (`groovy-bio-capable`), not popped in later. The
  bubble only moves and grows; only the ARC rotates (turning the whole
  bubble swung the arrow sideways and tipped the label over), and the
  arrow flips with `scaleY(-1)`, never through sideways. Behind the card,
  on a phone, the layer is `--surface`. **Haptics** (`navigator.vibrate`,
  Android only; iOS has no API): 8ms tick at the threshold, 14ms on
  release, `[10,50,16]` when done, `[10,40,10]` on an update. Chrome drops
  vibrate until the page has been tapped once, so the very first
  threshold tick on a fresh page can be silent. **Verified by driving a
  real touch gesture in headless Chromium** (playwright-core + CDP
  `Input.dispatchTouchEvent`, per-frame transform log): 263 frames, the
  card never jumps more than 5.8px a frame, no reload on the current path.
- **Pull down to refresh on the login and lock screens is OURS**
  (`_gvPullToRefresh`, js/auth.js), because `overscroll-behavior:none` —
  the no-scroll fix — also switches off the browser's own. Rubber band
  `128·(1−e^(−dy/140))`, refresh at 72 (≈120px of finger), a ring that
  fills, an arrow that flips with a buzz, the card following at 0.4×. It
  only starts at `scrollTop 0` (with the keyboard open the drag is a
  scroll) and takes the gesture with `preventDefault`. A release first asks
  the service worker to `update()` (≤2.5s) and then reloads — so a pull
  also brings in a new build, which a plain reload behind a cache-first
  worker does not promise. Driven in `tests/login.test.js`.
- **FINGERPRINT SIGN-IN (passkeys) — 26 Sept, REVERSES "not built".**
  Afnan tried the lock and reported "it does not log in by fingerprint":
  he wanted a fingerprint button ON the login screen. He chose "both":
  - `netlify/functions/passkey.js` is the boundary. `register-options` /
    `register` (caller's verified ID token) store `passkeys/{credentialId}`
    = the PUBLIC key (SPKI), alg, rpId, uid **from the token**, signCount.
    `login-options` / `login` verify: single-use 2-min challenge (read and
    deleted in one transaction), `webauthn.get`, the challenge, the
    **signed** origin (exactly `https://groovyoperations.netlify.app` or a
    `--groovyoperations.netlify.app` preview), rpIdHash, UP **and UV**, the
    ES256/RS256 signature, a non-regressing counter, and a live, enabled
    Firebase user; only then `createCustomToken(uid-stored-with-the-key)`.
    `passkeys` and `passkey_challenges` have **no** `firestore.rules` block
    (default deny — asserted), so no client can touch them and **no
    republish was needed**.
  - One fingerprint sets up both: `lockEnable` registers the passkey and
    uses the same credential id as the lock record. Server unreachable →
    the lock still turns on locally, and the toast says sign-in did not.
    Needs `getPublicKey()`/`getAuthenticatorData()` on the response
    (current Chrome/Safari).
  - Login screen: **"Sign in with fingerprint"** (`#login-finger`, shown
    when this phone holds a passkey record, `localStorage['groovy-passkey']`,
    by username) → `signInWithCustomToken` (bridged in index.html). A 404
    (key removed) forgets it locally. A **key button in the password
    field** (`loginFillSaved`) asks Chrome's password manager for the saved
    password via `navigator.credentials.get({password:true})` and signs in;
    Chrome only, and whether Chrome wants a fingerprint first is ITS setting.
  - `tests/passkey.test.js` (56) runs the function with REAL P-256 and RSA
    keys, byte-built authenticator/client data, and every refusal (replay,
    other key, no UV, other challenge/origin/rpId, expired, unregistered,
    copied counter, disabled/deleted user, stealing a key id, removing
    someone else's); six guards reverted and caught. **Unverified:** that
    `FIREBASE_SERVICE_ACCOUNT` can sign custom tokens (it must hold a
    private key — the other functions only prove it can read/write), and
    what a real phone sends. Afnan's phone is the first real test.
- **"Choose an account" is OUR sheet, not Chrome's (27 Sept, recording 3).**
  The key opened Chrome's full-screen "Sign in as" list with blank grey
  avatars (Afnan's own row had his picture — the `iconURL` fix worked — but
  every account Chrome saved by itself had none). That window is Chrome's: no
  site can size, style or add pictures to it. The key now opens
  `#login-accounts`, a half-height sheet (`.login-acct-list` ≤52vh, scrolls)
  listing the accounts that signed in HERE with Remember me
  (`localStorage['groovy-accounts']`, {u:{name,photo,at}}, recorded on every
  password and passkey sign-in; most recent first). **Chrome's own list
  cannot be read by any site**, so accounts Chrome saved before this shipped
  appear once that person signs in again. **Photos cannot be read before
  sign-in** (user_profiles needs a signed-in reader), so after any sign-in
  `_profileCacheAccountPhotos` (js/profile.js) refreshes the picture of
  every account ALREADY on the list from the team directory — one
  `user_profiles` read, only when there is someone besides you; a refresh
  never adds anyone. A photo must be an anchored
  `https://res.cloudinary.com/` URL; names are `textContent`. A row with a
  fingerprint key on this phone signs straight in; any other fills the
  username and focuses the password. "All saved passwords" still opens
  Chrome's list; with nobody on the list the key goes straight there.
- **The app frame cannot be selected, saved or searched (27 Sept).**
  Afnan's recording: a long-press on the logo opened Chrome's image menu
  (Copy / Download / Share / Open in Chrome), a long-press on text started
  a selection that spread over the screen, a tap on text raised Google's
  "Tap to search", and the logo dragged off as a picture. `user-select:none`
  + `-webkit-touch-callout:none` on the login, lock and the app's CHROME
  (`.topbar,#sidebar,#mob-nav,.mob-sheet,.login-sheet,#gv-overlay`, every
  `button`/`label`); inputs keep `user-select:text`; `img{-webkit-user-drag:
  none}` everywhere. Chrome/Android still opens its long-press menu without
  JS, so js/auth.js `preventDefault`s `contextmenu`, `dragstart` and
  `selectstart` inside `_GV_FRAME` — never in a field or contenteditable.
  **Page content stays selectable on purpose** (copying a PO number is daily
  work), and Mood Boards keeps its own menus (not in the frame; the 30
  smoke-phone checks still pass). Verified in headless Chromium by
  dispatching the events and reading computed styles.
- **"Saving…" only for a save somebody made (27 Sept).** Afnan: it said
  Saving as soon as the app opened. Every Firestore write goes through the
  `__bootApp` wrap, and a write slower than 260ms raised the blocking
  overlay — including the app's OWN start-up writes (sign-in log, profile
  row, The Board's `boardLastSeenAt`). `_gvWriteStart` (js/shared.js, a
  cross-track file — one rule added) now also treats a write as ambient,
  i.e. silent, when (a) `Date.now() < _gvQuietUntil` — `startApp` opens an
  8s window with `window._gvQuietFor(8000)` — or (b) nobody has tapped or
  typed in the last 5s (`_gvLastInput`, capture-phase `pointerdown` and
  **`keyup`** — not keydown, because The Board's test counts the document's
  keydown listeners). A save after a tap still says Saving…. The handover:
  the login fades out (`_loginLeave`) and `#scr-app` fades up
  (`.gv-enter`, 420ms); The Board's first paint is a shimmer skeleton
  (`_tbSkeleton`, reusing `.gv-skel`) instead of the word "loading…".
- **Swipe down closes a login sheet (27 Sept)** — Afnan: "down to close
  does not work"; it had never been built. `_loginSheetDrag` on both sheets:
  the card follows the finger 1:1, the backdrop fades with it, release closes
  past a third of the card's height or on a flick (>0.45px/ms), else springs
  back; in the account list it only takes over at `scrollTop 0`. Sheet
  touches `stopPropagation` and the pull-to-refresh also ignores any touch
  starting in `.login-sheet`. **Verified by driving CDP touch gestures in
  headless Chromium** (short drag → stays, long drag → closes, flick →
  closes, both sheets, refresh never fired). Note for re-testing: a CDP
  touch event takes ~50ms to land when the page has listeners, so a "fast"
  10px-step gesture measures ~0.2px/ms — use 45px steps to simulate a flick.
- **Busy = the whole button, never a spinning icon (27 Sept).** Afnan: a
  rotating fingerprint while signing in "is stupid". While the phone and
  the server answer, a sheen sweeps across the button (`loginSheen`, a
  `::after` at `z-index:-1` inside `isolation:isolate`, so it sits over the
  button's fill and under its text) and the outlined fingerprint button's
  border breathes; on success the button turns to "Signed in" and FILLS
  solid (`.ok`) for 260ms before the login fades. Same on the password
  button. The outlined button needed a stronger sheen (.42) — at .30 it was
  invisible over no fill, seen in a render, not guessed. Tests assert no
  rule spins the icon.
- **Desktop: "Sign in with a passkey" (27 Sept).** Afnan: the phone shows
  the fingerprint lock, the desktop "does not hold fingerprint". A
  passkey lives on the device that made it, so a computer has no local
  record. On a computer (`_loginIsDesktop`: ≥561px, `hover:hover`,
  `pointer:fine`) the button now shows anyway, labelled "Sign in with a
  passkey", and asks for a DISCOVERABLE credential (no `allowCredentials`)
  — the browser then offers a passkey synced to its account, or "use a
  phone" (QR → the phone's fingerprint, the `hybrid` transport). The
  server needs no change: it finds the uid from the credential id. Keys
  are registered with `residentKey:'preferred'`. **Unverified:** whether
  the key Afnan's Samsung made is discoverable/synced (it depends on which
  passkey provider the phone used — Google Password Manager or Samsung
  Pass); the QR route works whenever the phone's key is discoverable.
- **Chrome's own "Use saved password?" sheet is not the fingerprint lock.**
  The lock comes AFTER a Remember-me sign-in (offered once) and then
  replaces the login on every reopen. Asking for a fingerprint before
  Chrome FILLS a password is Chrome's setting, not the app's.
- **Recording 5 (27 Sept): fingerprint sign-in never came back.** On a
  phone signed into by five people, the "next time" box was still offered
  and "Sign in with fingerprint" never appeared — i.e. NO sign-in key was
  ever saved on that phone, so the server half of the set-up failed. **The
  failure's text was not in the recording, so its cause is NOT known.**
  Three logic bugs that made it permanent are fixed: (1) `doLogin` gated
  the set-up on the LOCK record, so a lock left behind by a failed server
  half made ticking the box do nothing forever — it gates on
  `passkeyFor(u)` now; (2) unticking only cleared the lock and left the
  sign-in key, it calls `lockDisable({quiet:true})` now; (3) the box and
  the fingerprint button looked at ANY key on the phone, they follow the
  TYPED username now (repainted on input and on picking an account).
  The failure reason is kept per username (`groovy-passkey-err`,
  `passkeyError`) and Profile shows it with **Set up fingerprint sign-in**,
  hydrated with `textContent`. Hedge, labelled: `passkey.js`'s origin check
  also accepts the request's own Host and Netlify's `URL` /
  `DEPLOY_PRIME_URL` / `DEPLOY_URL` (a custom domain would have been
  refused with 403), and a 403 now names the origin it saw. **If it still
  fails, Profile shows the exact reason — ask for that text.**
- **NO TICK BOX (27 Sept, Afnan) — REVERSES "the fingerprint choice is
  ON the login screen".** *"it should be the case after first login …
  when a fingerprint is not registered it should direct to sign in and
  when sign in is done later it should use fingerprint."* The
  "Unlock with fingerprint next time" row is DELETED (markup, CSS, the
  `l-bio` reads). Now: (1) a password sign-in with Remember me, on a phone
  that can check a fingerprint, with no key for that username here, asks
  the phone to set it up straight away (`_fpShouldSetUp`, the whole rule);
  (2) cancelling that dialog is remembered per username
  (`groovy-fp-declined`, `_fpDeclined`) so it does not nag every sign-in —
  Profile → Turn on clears it; (3) when the LOGIN SCREEN comes up
  (`_loginAutoFinger`, called from both `scr-login` display sites in
  `js/shared.js`) and the username in the field has a key on this phone,
  the fingerprint is asked for at once — once per page load, never right
  after a deliberate sign-out or "Use password instead"
  (`sessionStorage['gv-no-auto-fp']`, set by both), never on a computer;
  a quiet refusal (the browser wanting a tap) leaves the button. An
  unticked Remember me no longer touches an existing key.
  `window.loginBioSync` survives only as a repaint of the button (the
  Remember-me box and cached markup call it). **Unverified on a phone:**
  whether Chrome on Android shows the fingerprint dialog without a tap —
  if not, the button is what works.
- **Desktop is a SPLIT SCREEN (28 Sept, Afnan: "this is not right for
  desktop view").** At `min-width:1024px and min-height:560px` the login is
  a brand half (`.login-brand` in `#scr-login`: wordmark, "People. Products.
  Progress.", one line of what is inside) and a form half without card
  chrome; the form's own logo and footer line hide there. Below 1024 the
  card and the phone screen are unchanged. The brand panel is a LITERAL
  dark in both themes with literal white ink, and carries an opaque
  `background-color` under its gradients — the probe reads only that, and
  without it measured the ink at 1:1 (the scrim lesson). Two more fixes from
  the same screenshot: Chrome's autofill blue-grey on the password box is
  covered by an inset shadow in `--surface-2` (`:-webkit-autofill`; **not
  seen on a real autofill** — the sandbox has no saved password), and the
  closed `.mob-sheet`'s upward shadow, which bled a grey band along the
  bottom of EVERY page, now shows only while it is open. Rendered and
  looked at in Chromium at 1919×941, 1366×768, 1100×700 and 800×900, both
  themes.
- **Nobody has signed in, saved a password or used the lock on a real
  phone** — the sandbox cannot sign in [29 Sept: a headless QA session can sign in and render — see "Sandbox limits"]. Rendered and measured in headless
  Chromium at 390/360px and desktop, both themes.

## The phone sweep (27 Sept 2026)

Afnan: *"can you debug groovy ops by yourself? Phone UI only."* The sandbox
cannot sign in [29 Sept: a headless QA session can sign in and render — see "Sandbox limits"], so the app was loaded in headless Chromium at 390px with a
stubbed Firebase and fake data, every page opened for seven roles in both
themes, screenshotted screen by screen (a full-page capture drags the fixed
bottom nav and the off-screen sheets into the middle of the picture — use
viewport-sized shots) and LOOKED at, then measured. Found and fixed:

- **Dashboard stage tiles** broke their labels mid-word ("Cuttin g",
  "Embe llishm ents"): seven `flex:1` tiles on one phone line.
  `.stage-ov-grid` (auto-fit, 88px min) → rows of three. Also the
  Embellishments overview row. `js/embellishments.js` is Ammar's file —
  two class swaps, tell him.
- **Users page** printed raw role keys (`Creator_content_ops_lead`,
  `Csr_lead`) and the long row pushed Reset password off the screen.
  `_roleLabel()` in `js/auth.js`; `.user-row` wraps the button under the
  name on a phone. The stage-owner names were `STAGES` literal ink —
  1.06:1 in dark; `var(--text)` now.
- **The toast sat on the bottom nav** (`bottom:20px` under a 71px fixed
  nav). Phone: `bottom:calc(84px + safe-area)`.
- **24–29px buttons and chips** (`.btn-sm`, `.btn-outline`,
  `.filter-chip`, `.dest-chip`) → 34px min-height on a phone, height only.
  The gate pass size row's remove × was 20×21 → 32×34.
- **Dark mode: the Dashboard KPI tiles** were `background:white` /
  cream literals under themed ink — 1.09–1.18:1. `var(--surface)` and dark
  overrides for the amber/red tints; light mode is unchanged.
- The bug tracker's tabs used a navy literal (1.13:1 in dark); the worker
  card's "No image" was `#aaa` (2.02:1); the payroll card's › wrapped onto
  its own line; Fabric Inventory said its title twice; the PO row left a
  dangling " ·" when a field was empty; the gate pass bundle header
  wrapped ("BUNDLES (E.G. 9-8-6-7)") — now Size · Bundles · Count · Qty.

**Seen and NOT changed** (judgement calls, not bugs): the Payroll and
Store Accounts tables scroll sideways on a phone (the columns are there);
the Inventory page opens on a 39-row low-stock list before the inventory;
Observer Tower opens on twelve zero tiles; the bug FAB passes over content
while scrolling. **Still only a phone can say:** the keyboard, the
fingerprint dialog and real data volumes.

## QA debug access (29 Sept 2026; was branch `qa-access-v2`, now on `main`) — read `QA_ACCESS.md`

Claude Code's login `claude@groovy.op` (role `qa`) is defined once, in `main`'s
`USER_DEFS`/`QA_ROLE`; the identity and its write fences are in BOARD.md → "The QA
identity". What this adds, not repeated here: the read-everything decision
(`isQaRead()`), `js/env.js` (the emulator switch, **localhost only**), the snapshot and
probe tools, and the emulator proof (`tests/rules-emulator-qa.js`: a read matrix, a write
matrix and a regression differential over every path parsed from the rules).

* **Never add a second `signedIn()` gate or a `request.auth != null` rule** — a test fails
  (`tests/qa-read-guard.test.js`). Every new `allow read` starts `isQaRead() ||` — except
  the Master Accounts family `ma_*` (next bullet); every new
  personal-data collection is therefore readable by QA — that is the decision, so decide
  whether the collection should exist, not whether QA may read it.
* **The exception: Master Accounts (`ma_*`, 15 collections) is owner-only by design** —
  afnan and ammar, "just for me and Ammar" — and QA is REFUSED there. Its read rules stay
  `isMasterAccounts()` alone; `tests/qa-read-guard.test.js` exempts them by name and holds
  that the exemption stays shut, `tests/rules-emulator-qa.js` part 1b proves the refusal, and
  `tools/qa-snapshot-lib.js` keeps them out of the default snapshot (`8573391`). **Held
  live only by a one-off:** `tools/qa-probe.js` still has no `ma_` line, but a REST list of all
  15 as the QA account on 29 Sept 2026 answered 403 for each (ambiguous between "block not
  published" and "block published, QA refused" — "Master Accounts" → "On `main` since").
  `QA_ACCESS.md` said QA reads owner-only collections; corrected 29 Sept 2026 (same change, second
  commit). See "Master Accounts" → "The gate".
* **A read no longer proves the QA rules are live** (it reads `pos` either way); the e2e
  harness's gate updates a nonexistent document instead.
* **Not verified from a session:** what the Console has published, as TEXT (behaviour
  is a different thing — see the 29 Sept 2026 blocks below), and the emulator switch
  inside a signed-in browser (`?env=emulator`, localhost only — the live e2e below did not use
  it). ~~whether the Auth account exists~~ — **SUPERSEDED 29 Sept
  2026: it exists and can sign in (blocks below).** ~~(gstatic is blocked)~~ — **SUPERSEDED
  29 Sept 2026:** that premise is false, and a headless QA session has signed in and rendered the
  Board page (the e2e block below, "Sandbox limits"). (`QA_ACCESS.md` §1 called the account's
  existence "Unknown"; corrected 29 Sept 2026, same change, second commit.) **Branch state,
  verified this run:** no remote branch named `qa-access*` exists (`git branch -r` and `git
  ls-remote --heads` find none) and `dc98484`, `b680d0b`, `b1872f4` and `08b530a` are ancestors of
  `origin/main`.
* **VERIFIED FROM A SESSION, 29 Sept 2026 — the live QA account, one run of
  `tools/qa-probe.js --live --sandbox-writes`.** Source: that tool's own output (exit 0,
  "All as designed."), relayed by the session that ran it to the agent that wrote this entry,
  which did not re-run it (a re-run creates and deletes documents in the live project). The
  "Firestore rules — published" section also mentions a live probe, reported there; whether
  that is this same run is not known.
  * **Environment:** `GROOVY_QA_URL`, `GROOVY_QA_EMAIL` and `GROOVY_QA_PASSWORD` are set in the
    session environment (verified: a set/not-set check on 29 Sept; values never printed and
    never written here).
  * **The working command** is `QA_PASSWORD="$GROOVY_QA_PASSWORD" NODE_USE_ENV_PROXY=1 node
    tools/qa-probe.js --live --sandbox-writes`. Verified by reading `tools/qa-probe.js`: with
    `--live` it reads only `QA_PASSWORD` from the environment (`QA_PROJECT` and
    `FIRESTORE_EMULATOR_HOST` matter only to `--emulator`; it reads none of `GROOVY_QA_PASSWORD`,
    `GROOVY_QA_EMAIL`, `GROOVY_QA_URL`), the email is hardcoded as `claude@groovy.op`, and it
    calls Node's built-in `fetch`, hence `NODE_USE_ENV_PROXY=1` per the README. A run of the
    probe without that variable was not tried; a plain `fetch` to the roots of
    `identitytoolkit.googleapis.com` and `firestore.googleapis.com` reached them (see "Sandbox
    limits").
  * **Sign-in:** it signed in as the QA account, so the Auth account exists and is enabled
    (verified by the sign-in itself), and the signed-in uid matched the uid pinned in the repo's
    `isQa()` (the probe exits 1 on a mismatch). The uid is deliberately not written here.
  * **27 writes refused:** every one of the probe's 27 create attempts against real collections
    got HTTP 403 — including the three `hrm_notifications` creates, which `tools/qa-probe.js` lines
    97–98 (read) define as `{forUser:'afnan',title:'probe'}`, `{forRole:'owner',title:'probe'}`
    and `{forUser:'claude',forRole:'owner',title:'probe'}` — the last is the row `qaOwnNotice()`
    exists to refuse (its own bell plus a whole role's); **the probe never sends the ALLOWED
    shape**, `{forUser:'claude'}` with no `forRole`, so "QA can write its own bell row" is not
    exercised by it; `user_profiles` with a foreign uid; `board_items`;
    `board_lists`; `mood_boards`; `payslips`; `employees`; `acct_entries`; `wh_sales`.
  * **35 reads open:** all 35 top-level collection lists in the probe's list returned HTTP 200,
    including `employees`, `payslips`, `acct_entries`, `wh_sales`, `acct_vendors`,
    `payroll_runs`, `mood_boards`, `board_lists`, `board_items`. `integration_secrets`,
    `passkeys` and `passkey_challenges` returned 403.
  * **The sandbox step:** a QA-only board list, one item assigned only to itself and a comment
    were created (200 each); the same list and item with a second person added were refused (403);
    the item and the list were then deleted. A read-only before/after listing of QA-owned
    documents (`board_lists`, `board_items` and `mood_boards` owned by QA, QA's
    `hrm_notifications`, QA's `user_profiles` row) showed no difference.
  * **What this shows about the live Console — behaviour only.** For those requests, the live
    project behaves as the repo's QA rules describe: role-gated reads open to QA, writes
    fenced. It does NOT show the Console's rules text, and it does not show that the published
    file equals the repo file.
  * **Limits of the probe** (verified: a read of `tools/qa-probe.js`): reads are top-level
    `?pageSize=1` lists only, so subcollections (`mood_boards/*/comments`,
    `board_items/*/comments`, …) are not read, and a 200 means the list was allowed, not that the
    collection holds data. Refusals are tested for CREATES of fresh documents only — never for
    an update or a delete of an existing document.
  * **Hypothesis, unverified:** the probe's sandbox step creates a comment under
    `board_items/<id>/comments` and then deletes only the item and the list. Read from the
    source (lines 139–145): the comment's id is generated inline and not kept, and no delete is
    issued for it, although the file's header says everything is "deleted straight after".
    Firestore does not delete a subcollection with its parent document, so one test comment
    (body "probe") probably survives under the deleted item. The session that ran the probe
    tried to list it as the QA account and was refused (403), so it could not be looked for
    from a session; only someone with Console or Admin access can confirm it.
* **VERIFIED FROM A SESSION, 29 Sept 2026 (later) — the Board e2e run LIVE as the QA account:
  6 of 7 checks; the 7th is a permission refusal, reproduced in the emulator.** Source: `tests/e2e/board.e2e.js` against
  `https://groovyoperations.netlify.app` (serving `v259`) at checkout `a436e8b`, 16:21:05 →
  16:21:30 UTC, read from the run's own `docs/board-screens/a436e8b/report.md` and `report.json`
  (both gitignored — `.gitignore` line 26 — so they exist only in that checkout) and its stdout
  (exit 1). Output goes to `docs/board-screens/<checkout>/`.
  * **Passed (6):** signed in with the `qa` role · signed in WITHOUT Remember me (no kept session,
    no saved password) · the rules refused it a write to `pos` (`permission-denied` — the run's own
    check that `isQa()` is deployed) · the same for `bug_reports` · the sandbox is a private QA
    list it runs alone · the composer takes the caret. The containment gate held. **0 page
    errors, 0 console errors.** No screenshots: it aborted before its screen matrix
    (`screens: []`).
  * **Failed (1), "the run completed":** *"timed out waiting for the new item — the app said:
    Refused — this item may be locked, or firestore.rules is not deployed yet. — the composer
    still holds: e2e a436e8b …"*. The run created a QA-owned `QA Sandbox` `board_lists` document
    (its id is in the report; not written here — the report records the creation and nothing about
    removal) and no `board_items` document (the item write was the refused step).
  * **The cause, reproduced in the local Firestore emulator** (a `demo-` project; it cannot reach
    live) by the earlier agent and re-run in this session from its scratch script
    (`qa-batch-repro.js`, scratchpad, not in the repo) against the repo's `firestore.rules`. The app
    creates an item with ONE `writeBatch`: `board_items/{id}` plus `board_items/{id}/activity/{a}`
    (`js/theboard.js` `tbCreateFromQuick`, lines 1782–1786, read). The activity `create` rule
    (`firestore.rules` L1131–1132, read: `… && ( !isQa() || tbOwnsItem(id) )`) judges ownership with
    `tbOwnsItem`, which reads the parent through `exists()`/`get()` — the state BEFORE the batch, in
    which the item does not exist yet — so for QA the batch is refused. Emulator results: QA item +
    activity in one batch → PERMISSION_DENIED (the emulator log names L1131 among its errors); QA
    item alone → allowed; QA activity row as a separate write afterwards → allowed; the same batch
    by a simulated ordinary user (`saim`) → allowed; QA writing activity on a real person's
    item, and QA batching a QA-flagged item into a real list → still refused (the fences intact).
  * **An untested-in-the-repo candidate fix, NOT applied:** judge ownership on the state after the
    batch — a `tbOwnsItemAfter()` built on `existsAfter()`/`getAfter()`, used by the activity and
    comments `create` rules only. On an in-memory copy of the rules, in the same emulator run, it
    turned the batch from refused to allowed and left the two fence checks refused (the run
    reported 11 passed, 1 failed — the 1 being the batch against the unchanged repo rules). It is
    not in the repo, has not been through `tests/rules-emulator-board.js` or
    `tests/rules-emulator-qa.js`, and would need a republish.
  * **Hypothesis, unverified: the live Console's `board_items` rules equal the repo's.** The
    app's message is shown for ANY permission error (`js/theboard.js` 1503–1505, read), so it does
    not say which rule refused. The probe's sandbox step (reported, above) created an item and then
    a comment as SEPARATE writes and got 200 for both — consistent with the emulator result and not
    evidence against a matching Console; a mismatch is not excluded.
  * **What is therefore FALSE on live today: "the QA account can create a Board item through the
    app."** Verified by the e2e failure above (the composer's one-batch path). A direct REST create
    of an item by QA is not affected (the probe's sandbox step, reported), so the limit is on the
    app's write path, not on the account's fence. Until the rule is fixed and republished, the
    harness's live run stops at its creation step and produces no screenshots.
  * **Environment prerequisite:** the proxy CA in Chrome's NSS store — reported by that run, not
    re-run; see "Sandbox limits".

## Credentials — never in client code

`js/*.js`, `css/*` and every `*.html` are **public static assets**, served
to anyone who visits before any login happens. Anything in them is readable
worldwide with a single `curl`. Treat them as published, always.

- **`USER_DEFS` (`js/auth.js`) holds identity, role and permissions only.**
  It must never carry a `pass:` field again. Login sends the password the
  user typed to Firebase Auth; the app never needs to know it.
- **There is no in-app account setup flow.** It was removed because it
  shipped every password to the browser to create accounts over the Auth
  REST API. To add a user: Firebase Console → Authentication → Add user,
  then add a `USER_DEFS` entry (no password) and a `firestore.rules` entry
  if the role needs scoping.
- **The real secrets are server-side and must stay there** — Netlify
  Functions read `SHOPIFY_CLIENT_SECRET`, `POSTEX_API_TOKEN`,
  `META_APP_SECRET`, `IG_ACCESS_TOKEN` and
  `FIREBASE_SERVICE_ACCOUNT` from `process.env`. Never move one client-side.
- **The Firebase web API key in `index.html` is not a secret.** It is a
  public project identifier that every Firebase web app ships. Do not try
  to hide it — Firestore rules are what actually protect the data.

Because Firestore rules grant broad access to any `signedIn()` user, a
leaked password is a full data breach. Rules are the only real boundary.

### Historical exposure (do not undo the fix)

Until Sept 2026 every password sat in `js/auth.js`, plus a "Default
passwords" card in the Users page and a credential list on the setup
screen. **Those values are still in git history and must be treated as
permanently compromised** — rotating them in Firebase Console is the only
remedy, and stripping them from `HEAD` does not undo the exposure.

### Rotating a password — self-service in-app, not the Console

Firebase Console's per-user "Reset password" (Authentication → Users → ⋮)
only **sends an email link** — it cannot set a password directly, and the
`@groovy.op` addresses are not real inboxes, so that path is a dead end
for this app. (Verified Sept 2026: the dialog offers nothing else.)

**Self-service (knows current password):** `window.openChangePasswordModal()`
(`js/auth.js`), wired to a "Change password" button in the topbar next to
Sign out. Any signed-in user re-enters their CURRENT password (Firebase
requires this for a sensitive change — `reauthenticateWithCredential` +
`EmailAuthProvider.credential`), then sets a new one via `updatePassword`.
Client SDK only, no server involved. `updatePassword`,
`reauthenticateWithCredential`, `EmailAuthProvider` are imported from
`firebase-auth.js` and bridged onto `window` in `index.html`, same pattern
as the rest of the Firebase Auth API there.

**Owner reset (locked out, doesn't know current password):**
`window.openOwnerResetModal(username)` — a "Reset password" button per row
on the owner-only Users page (`renderUsers()` already gates the whole page
to `session.role==='owner'`). Posts the owner's own Firebase ID token
(`auth.currentUser.getIdToken()`) plus the target's email and a new
password to `netlify/functions/admin-reset-password.js`. That function
**never trusts a client-asserted role** — it calls
`admin.auth().verifyIdToken()` server-side and checks the decoded email
against a hardcoded `OWNER_EMAILS` list (mirrors `isOwner()` in
`firestore.rules`) before touching anything. Only then does it call
`admin.auth().updateUser(uid, {password})` — the Admin SDK, which is why
this must stay server-side; it bypasses all security rules by design.
`OWNER_EMAILS` in the function and `isOwner()` in `firestore.rules` must be
kept in sync — a third owner added to one and not the other breaks this.

The new password is shown once, client-side, then never stored or logged
anywhere (the activity-log entry records who reset whose password, never
the value) — the owner must copy and share it before closing the modal.

## Realtime Database rules

Canonical copy: `database.rules.json`. Publish it at
Firebase Console → Realtime Database → Rules.

```json
{ "rules": { "attendance": { ".read": "auth != null", ".write": false } } }
```

Why this is safe, verified from the code:

- **The browser never writes to RTDB.** The bootstrap in `index.html` imports
  only `get`, `onValue`, `child`, `ref`, `off` from `firebase-database.js` —
  no `set`/`update`/`push` exists client-side, and no `js/*.js` calls one.
- **All writes come from `netlify/functions/iclock.js`**, the ZKTeco/ADMS
  receiver, using `firebase-admin` with a service-account credential. The
  Admin SDK **bypasses security rules**, so `".write": false` does not
  affect attendance capture. `attendance-sync/` holds no credentials.
- **Every path the app touches is under `attendance/`** — `attendance/live`,
  `attendance/_meta`, `attendance/{date}/{k40}`. Nothing reads the root, so
  scoping the rule to `attendance` leaves everything else denied by default.

`.read` is `auth != null` (any signed-in user) because payroll reads whole
days wholesale — `attendance/{date}` — for every employee. Per-user
restriction would break the HRM dashboard and needs a code change first.

Until Sept 2026 these rules were `{".read": true, ".write": true}` — the
attendance data was world-readable **and world-writable**, with no login,
which meant anyone could have altered the records payroll is computed from.

## Firestore rules — published, verified matching (Sept 2026)

**Afnan's standing preference: when asked for "the rules," paste the
complete, current `firestore.rules` file, not a diff/snippet.** He copies
the whole thing into the Firebase Console in one paste. Read the live file
fresh each time rather than reconstructing it from memory or from an older
turn in the conversation.

**No republish outstanding as of 30 Sept 2026 (~12:23 UTC) — Master Accounts M2
rules reported published, if he published the M2 file: reported by Afnan, not
checkable.** Afnan wrote "done rules updated" in-session at about 12:23 UTC on
30 Sept 2026 (as relayed to this session), taken to mean that he published the
Firestore rules. **That is a report and nothing more: nobody in a session can
read the Console**, so nothing below is checked against it — only its rules
history can say what it holds. His message did not name the file.

1. **The file he had been sent** (as relayed): the complete M2 file,
   `firestore.rules` on `main` at `ca325c1` — LF md5
   `85ac93b115c0c75ba0213d7371cc6958`, 1,748 lines, 19 `match /ma_` blocks
   (verified this session: `git show ca325c1:firestore.rules | tr -d '\r' |
   md5sum`, `wc -l` and `grep -c`), the same bytes as at `6410744` (verified: the
   same `md5sum`). He was also given a raw GitHub link pinned to that commit (as
   relayed). The session that sent it reported that the bytes it fetched
   matched the md5 (as relayed), and a fetch of `firestore.rules` at that pinned
   sha here agreed (verified: HTTP 200, 103,308 bytes, LF md5 `85ac93b1…`, 1,748
   lines) — so the bytes behind the link are the repo file's, not a local copy's;
   the 29 Sept evening entry below says why that matters. **That the file he
   published is THIS one is a hypothesis, unverified.**
2. **What the file adds** over the FINAL M1 file (`9d7ec162…`, 1,526 lines, 15
   `ma_*` blocks — verified at `914b67a`): the `ma_cpr`, `ma_collection`,
   `ma_claims` and `ma_runs` blocks (lines 1672, 1684, 1693 and 1735 of the file
   — verified) and the rules that hold a dispute (`maDisputeOk`: one open at a
   time, `disputes` append-only — S7) and a claim (`maClaimOk`, `maClClaimedOk`:
   one live collection per receipt — S2). `git diff --numstat 914b67a ca325c1
   -- firestore.rules` reads +226 −4 (verified); the helper list and the four M1
   lines it changes are in item 1 of the superseded entry below.
3. **What should clear, if he published it** (hypothesis, unverified): the
   courier pages' "incomplete — <collection> could not be read" (Money in ▸
   Couriers and Today) and the refused collection, claim, dispute and
   courier-statement writes — item 3 of the superseded entry below says why they
   were refused. **The test from Afnan's side:** Money in ▸ Couriers loads
   without the "incomplete" notice. It needs the M2 build served, and whether
   Netlify built `6410744` is still unconfirmed (the M2 section: the deploy list
   was not read). A session cannot run it: the pages are owner-only and the QA
   account is refused on `ma_*` by design.
4. **If it was another file,** the Console may still hold the FINAL M1 file and
   everything in item 3 still applies; only the Console's rules history
   (Firebase Console → Firestore → Rules) says which is live. If a courier read
   or write is still refused after the publish, that is new evidence: item 5 of
   the superseded entry below has the two things to check (the signed-in email,
   the device clock) before reopening the code. `git log --oneline -1 --
   firestore.rules` is `53ba832` (verified); a newer commit there is a change he
   has not been sent.

This supersedes the "REPUBLISH OUTSTANDING (30 Sept 2026)" entry directly below
**if** the hypothesis in 1 holds; that entry stays for its detail, and the
29 Sept entries below it are unchanged.

**SUPERSEDED 30 Sept 2026 (~12:23 UTC) by the entry above, which records
Afnan's report that he then published the rules (file not named — hypothesis,
unverified: the M2 file this entry describes; not checkable). Kept for its
detail: what the M2 file adds, and what each Console state refuses. Was:
REPUBLISH OUTSTANDING (30 Sept 2026) — Master Accounts M2: the couriers'
rules. Sent to Afnan, NOT reported published.** ~~Read this before the "No
republish outstanding" entries below, which are dated to the days they name.~~
*(SUPERSEDED 30 Sept 2026: read the entry above first; this one is its detail.)*

1. **The file to publish** is `firestore.rules` on `main` at `6410744`: LF
   `md5 85ac93b115c0c75ba0213d7371cc6958`, 1,748 lines, 19 `match /ma_` blocks
   (verified 30 Sept: `tr -d '\r' < firestore.rules | md5sum`, `wc -l`, `grep
   -c`). Against the FINAL M1 file (`9d7ec162…`, 1,526 lines, the entry below;
   `git diff --numstat 914b67a 6410744` reads +226 −4) it adds the blocks
   `ma_cpr`, `ma_collection`, `ma_claims` and `ma_runs` and their helpers
   (`maStatementCreateOk`, `maCollectionShapeOk`, `maClaimOk`,
   `maClClaimedOk`, `maDisputeOk`, …), and changes three M1 rules for the new
   document types — four lines replaced, read from that diff: `maShapeOk` gains
   `cpr` (`maStatementShapeOk`) and `collection` (`maCollectionShapeOk`), the
   create rule's per-type branch gains `collection` (`maClBornOk`), and the
   figure fields that clear a review gain `net`; two clauses also join the edit
   rule (`maClEditOk` for a collection, and an edit reaches only a typed
   statement, never a derived one). Publish it **from the repo file, not a
   local copy** — the lesson of the 29 Sept evening entry below.
2. **Sent 30 Sept (as relayed); not reported published.** An earlier M2 file —
   LF md5 `d56929aa04f40928de3e0ea14a449442`, 1,675 lines, the file at
   `0a5b6d6` (verified) — was sent on 29 Sept, never reported published, and is
   superseded: it has the three courier blocks but no `ma_claims` and no
   dispute history (S2, S7).
3. **Until it is published** the Console most likely holds (hypothesis,
   unverified) the FINAL M1 file, which Afnan reported publishing at about
   16:18 UTC on 29 Sept without naming it. That file has no rule for the four
   collections, so they are default-denied, owners included: **the courier
   reads are refused** — Money in ▸ Couriers and Today say "incomplete —
   <collection> could not be read" for what depends on them and the rest of
   Master Accounts carries on — and **collection, claim, dispute and
   courier-statement writes are refused**. The rollup writes with the Admin
   SDK, which bypasses the rules, so it can run; its output cannot be read
   until they are published.
4. **What each state of the Console refuses,** measured in the real emulator
   with `tests/rules-emulator-ma.js` (364 checks) run against a copy of
   `6410744`'s tree with the older file swapped in — the suite reads
   `firestore.rules` from its own tree, so pointing the emulator at another
   file proves nothing (a first attempt did exactly that and was discarded):
   the M1 final file fails **40** (every courier read and every statement,
   collection, claim and dispute write); the 29 Sept file fails **27** (the
   claims and the dispute history); `85ac93b1…` fails none — **364 passed**
   (re-run 30 Sept). That is what makes the republish necessary rather than
   cosmetic.
5. **His test:** Money in ▸ Couriers loads without "incomplete — … could not be
   read", and **Run now** ends "Done at …". A session cannot run it: the pages
   are owner-only and the QA account is refused on `ma_*` by design. If a
   courier read or write is still refused after the publish, check that the
   signed-in email is exactly `afnan@groovy.op` or `ammar@groovy.op` and that
   the device clock is within five minutes of the real time (M1's audit rule)
   before reopening the code.

**No republish outstanding as of 29 Sept 2026 (~16:18 UTC), if he pasted the
final file — reported by Afnan, not checkable.** Afnan wrote "rules updated
record" in-session at about 16:18 UTC (as relayed to this session), taken to
mean that he published the Firestore rules in the Firebase Console and wants
it recorded. **That is a report and nothing more: nobody in a session can
read the Console**, so nothing below is checked against it — only its rules
history can say what it holds. His message did not name the file, or say how
he published it. `git log --oneline -1 -- firestore.rules` is `ef7eabb` (the
ninth merge of `main` into the Master Accounts branch, v258).

1. **The file he had been sent.** Ten minutes earlier (16:10 UTC, as relayed)
   he was sent the complete FINAL file: `firestore.rules` at `914b67a`
   (byte-identical at `a436e8b`) — LF md5 `9d7ec162b9812b5358d2ce07a400824a`,
   1,526 lines, 15 `match /ma_` blocks (verified this session with `git show
   914b67a:firestore.rules | md5sum`, `wc -l` and `grep -c`); against `main`'s
   rules at `11bd681` it adds 384 lines and removes none (`git diff --numstat
   11bd681 914b67a -- firestore.rules` reads `384 0`). **That it is THIS file
   he pasted is a hypothesis, unverified.**
2. **The three publishes reported on 29 Sept, in the order reported** (all
   reported, none checkable): (1) Afnan's merged Master Accounts file
   `acc9a3a1…` (LF md5 `acc9a3a1cec525ee4e1d335da30124fe`, 1,502 lines, no
   `isQaRead()`); (2) Ammar's — `main`'s own file `7d858a05…` (LF md5
   `7d858a05ce8ecf6aae585bbd79892960`, 1,142 lines: the QA-read rules and no
   `ma_*` block), recorded in `main`'s entry below (`11bd681`); (3) this one,
   Afnan's "rules updated". The entry below could not order (1) and (2) from
   the repo; the Console's rules history can.
3. **What it means.** *Hypothesis, unverified:* if he pasted the final file,
   the `ma_*` rules are live (Master Accounts loads for Afnan and Ammar) and
   so are `main`'s QA-read rules (the file carries `isQaRead()` — ~~93~~ 94 lines,
   verified; corrected 29 Sept 2026, see below), and nothing is outstanding. If it was another
   file — a local copy, or one of the two earlier — the Console may still hold Ammar's (no
   `ma_*` block: Master Accounts denied to everyone, failing closed) or
   Afnan's earlier merged one (no `isQaRead()`); the entry below says what
   each state refuses.
4. **The test that can show it worked, from Afnan's side:** a Master Accounts
   page loads for him or Ammar instead of *"Could not read … — republish
   firestore.rules with the Master Accounts block"*. It needs a build with
   Master Accounts in it to be served, which is the Netlify deploy in 5. ~~A
   live QA probe (`tools/qa-probe.js --live`, which needs the QA account's
   password) has NOT been run~~ *(SUPERSEDED 29 Sept 2026, later: one was run and its
   result relayed — see "QA debug access")* — and **it has no `ma_` line** (verified:
   `grep -n "ma_" tools/qa-probe.js` finds nothing), so it could not show
   that the QA account stays refused on `ma_*`; only the emulator holds that
   (`tests/rules-emulator-qa.js` part 1b). ~~Nothing checks it live.~~ *(SUPERSEDED 29 Sept
   2026, later: a one-off REST list of all 15 `ma_*` collections as the QA account answered 403
   for each — "Master Accounts" → "On `main` since"; ambiguous between "block not published"
   and "block published, QA refused", so it does not show the block is live.)*
5. **`main` and the deploy.** `main` was
   `914b67a22ecf6d59b9d9c73e68f4cd445d36c3e9` when this was written
   (verified: `git ls-remote origin refs/heads/main`, 16:17 UTC as relayed
   and again at 16:24 UTC here; it was fast-forwarded to `a436e8b` first, then
   to `914b67a`). GitHub Actions `tests` on `main`, read from the check-runs
   and workflow-runs APIs at about 16:25 UTC: `a436e8b` (run 36595973484) and
   `914b67a` (run 36596441345) both completed with conclusion success
   (16:12–16:18 and 16:16–16:22 UTC). That is CI. **Whether Netlify built the
   deploy is UNCONFIRMED:** nobody in a session can see its deploy list
   (~~`*.netlify.app` is blocked here~~ *SUPERSEDED 29 Sept 2026: the site answers, and its
   Master Accounts files were byte-identical to `origin/main`'s — see "Master Accounts"; the
   deploy LIST is still unseen*, and this repo carries no Netlify commit
   statuses); only Afnan reading it can say.

This supersedes the "REPUBLISH OUTSTANDING (29 Sept 2026, evening) — the FINAL
file" entry directly below **if** the hypothesis in 1 holds; that entry stays
for its detail, and `main`'s own entry below it is unchanged.

**SUPERSEDED 29 Sept 2026 (~16:18 UTC) by the entry above, which records
Afnan's report that he then published the rules (file not named — hypothesis,
unverified: the FINAL file this entry describes; not checkable). Kept for its
detail: what the final file adds, and what each Console state refuses. Was: REPUBLISH OUTSTANDING (29
Sept 2026, evening) — the FINAL file, the one now on `main`, is not what the
Console reportedly holds, and Master Accounts may be denied there.** Read this
entry, then `main`'s own entry directly below it, which this one does not
replace.

1. **The file to publish** is `firestore.rules` on `main` (this branch's
   tip): LF `md5 9d7ec162b9812b5358d2ce07a400824a`, 1,526 lines, 15 `match
   /ma_` blocks, ~~93~~ 94 lines mentioning `isQaRead()` (its definition, two comment
   lines and 91 read rules; none inside an `ma_` block — corrected 29 Sept 2026:
   `grep -c isQaRead firestore.rules` reads 94, and the three lines that are not `allow read`
   rules are 45, 52 and 499). It is `main`'s own file
   at `1b56a46` (LF md5 `7d858a05ce8ecf6aae585bbd79892960`, 1,142 lines)
   plus the Master Accounts block — **384 added lines, none removed**
   (verified with `diff` against `main`) — and those 384 lines are
   byte-identical, in order, to the ones in the file Afnan published
   (verified with `cmp`). Publish it **from the repo file, never from a
   local copy**: `main`'s entry below records that the file live before
   Ammar's paste matched none of the committed versions, having been
   published from a local file on Afnan's PC.
2. **Two publishes were reported on 29 Sept, and neither is that file.**
   Neither can be checked from a session.
   - **Afnan's** ("rules published", reported in-session; not recorded in a
     commit): the merged file at `dcfef5c` (the same bytes at `1ae7e71`
     through `69f5c72`), LF md5 `acc9a3a1cec525ee4e1d335da30124fe`, 1,502
     lines — `main`'s rules with the Mood Boards sharing roles and `isQa()`,
     plus the Master Accounts block with M1.6a and V3. It has **no
     `isQaRead()`** (verified: 0 uses), so the QA-read rules that `main`'s
     entry calls live are not in it.
   - **Ammar's**, in `main`'s entry below (`11bd681`; reported there):
     `main`'s own file at `08b530a`, LF md5 `7d858a05…`, 1,142 lines — the
     QA-read rules and the QA account's uid pin, and **no `ma_*` block**
     (verified: 0 `match /ma_`).
   **The order is not recorded**; only the Console's rules history (Firebase
   Console → Firestore → Rules) says which was last. *Hypothesis,
   unverified:* Ammar's was later — his file was first committed at 11:15
   UTC (`b680d0b`) and, with the uid pin, at 13:57 UTC (`070c05d`); Afnan's
   file was committed at 09:40 UTC (`1ae7e71`). **One thing does not fit:**
   `main`'s entry says the file live before Ammar's paste matched none of 71
   committed versions, yet `acc9a3a1…` is a committed version; a scan of the
   70 commits, on any ref this checkout holds, that touch the file finds no
   match for `main`'s two md5s either. So either Afnan's paste was a
   different local file, or it came after Ammar's.
3. **What that means for Master Accounts.**
   - **If Ammar's file is the live one:** the Console has NO `ma_*` rules,
     so **every Master Accounts read and write is denied — to Afnan and
     Ammar too.** It fails closed: each page shows *"Could not read … —
     republish firestore.rules with the Master Accounts block"* and the
     dashboard card *"Could not read …"*. Nothing is lost: nothing could be
     written.
   - **If Afnan's file is the live one:** Master Accounts works, and the
     QA-read rules are not live — the reverse of what `main`'s entry says.
   - **Either way, publishing the final file settles both.**
4. **What the final file adds over the one Afnan published**
   (`git diff --stat 69f5c72 HEAD -- firestore.rules`: 122 insertions, 98
   deletions, from `60e333e`, `2fd62db`, `b680d0b`, `070c05d` and the ninth
   merge `ef7eabb`): `main`'s QA-read work — `isQaRead()` (the QA account,
   `get` and `list` only) OR'd first into 91 read rules; the combined
   `allow read, write` statements split, so a QA read cannot carry a write
   (38 combined lines in the file Afnan published, none left outside the
   `ma_*` blocks); `isQa()` also pinning the QA account's Firebase uid
   beside its email; and a notification fence (a QA `hrm_notifications` row
   is for the QA account and never carries `forRole`). **It adds nothing to
   any `ma_*` rule and takes nothing out of one** — Master Accounts is the
   one exemption from read-everything: the `ma_*` reads stay
   `isMasterAccounts()` alone (`8573391`, "The gate"), and in the emulator QA
   is REFUSED `get` and `list` on all 15 (`tests/rules-emulator-qa.js` part
   1b, 604 / 604 in that suite, reported by the merge agent). ~~**Nothing
   checks that live:** `tools/qa-probe.js` has no `ma_` line (verified with
   `grep`).~~ *(SUPERSEDED in part 30 Sept 2026: `tools/qa-probe.js` still has no
   `ma_` line (`grep -c` reads 0), but a one-off REST list of all 15 `ma_*`
   collections as the QA account on 29 Sept answered 403 for each — ambiguous
   between "block not published" and "block published, QA refused"; "Master
   Accounts" → "On `main` since".)*
5. **After the publish**, a Master Accounts page loads for Afnan or Ammar
   (the "could not read" cards stop); the QA half is `main`'s own live probe
   (`tools/qa-probe.js --live`, exit 0, as `main`'s entry describes). ~~A
   session can do neither.~~ *(SUPERSEDED 29 Sept 2026, later: a session can run
   the probe when the QA account's password is in its environment — one ran
   `tools/qa-probe.js --live --sandbox-writes` as the QA account and relayed its
   output, exit 0 ("QA debug access"); the Master Accounts page test is still
   Afnan's.)* If a Master Accounts read or write is still
   refused after this, check that the signed-in email is exactly
   `afnan@groovy.op` or `ammar@groovy.op` and that the device clock is
   within five minutes of the real time, before reopening the code.

**No republish outstanding as of 29 Sept 2026 (evening) — the QA-read rules
are LIVE.** Ammar published from the repo file (Console paste, reported
in-session, not checkable from a session): first `b680d0b` (`isQaRead` on
every read rule, `qaOwnNotice`), then a small edit of `isQa()` to pin the QA
account's uid beside its email (`08b530a`, whole file `md5
7d858a05ce8ecf6aae585bbd79892960`, LF). **The ruleset that was live BEFORE
this was NOT the one this file recorded** (`430fc28`, `b68fc9fe…`): the
Console held a file with `isQa()` in it whose LF-normalised md5 was
`e0d971e48776918a669a1c89f6ee3211` (`62646c6b…` with a trailing newline) and
which matches none of the 71 committed versions of `firestore.rules` — it was
published from a local file on Afnan's PC. Its text is saved at
`C:\gv-backup\published-rules-before.txt` on the PC used for the rollout;
**that file, not `430fc28`, is the rollback target**. Live probe
(`tools/qa-probe.js --live --sandbox-writes`, new password, exit 0) passed
after the pin, and it exits 1 if the account's live uid differs from the pinned
one. Anything that publishes `firestore.rules` must start from the repo file,
not from a local copy. `RESTORE` = paste the backup, or `git show 430fc28:`
only if the backup is lost (it drops the QA fence entirely).

**No republish outstanding as of 26 Sept 2026 (session 2) — rules AND
indexes.** Afnan deployed with the Firebase CLI from `main` at `f18536c`
(the PR #88 merge), `firebase use` → `groovy-gatepass`, from the repo file
at `md5 95273f84be02ebf8f0a54bae9f814dae` (LF) — `git log --oneline -1 --
firestore.rules` is `801bcfd`. `firebase deploy --only firestore:indexes`
("deployed indexes in firestore.indexes.json successfully for (default)
database"; no prompt to delete an index, no `--force`) then `firebase
deploy --only firestore:rules` ("released rules firestore.rules to
cloud.firestore"). All **13** composite indexes reported **Enabled**, none
in Error. The CLI output was pasted into the session; the Console's own
state was reported by the human and cannot be checked from a session.
**That one file carries every entry below still headed "was outstanding"**
— the Board's lock rule and its phase-1 `board_*` rules, the warehouse
handover and its review round, Raees's edit rights, and Ammar in
`isAcctSuper()` — so this supersedes all of them. **The CLI is the publish
route from now on** (`firebase.json` + `.firebaserc`, on Afnan's machine);
the Console paste still works. If a write in any of those areas is still
refused after this, that is new evidence — reopen the code, not the rules.

**No republish outstanding as of 14 Sept 2026.** Afnan republished at
1:38 pm that day (confirmed from the Console's own rules history), from the
repo file at `md5 e922310a963b373ba41d6dd434d276b8` — the version carrying
the `user_profiles` admin-update clause (owners + Mustafa may edit others;
Mustafa may not edit an owner's). `git log --oneline -1 -- firestore.rules`
is `e3270c0`; if it ever shows something newer than that, ask for a
republish.

**Last republished by Afnan on 13 Sept 2026**, from the repo file at
`md5 95f72eb712079666da1f53acb4019ba9` — which covers Mood Boards Stage 6
(`sharedWith`, TEAM update, the presence/comments/activity sub-collections)
AND `user_profiles`. Both had been waiting; the Profile page's own error
card is what finally surfaced it.

**Republished a fifth time by Ammar on 17 Sept 2026, after PR #73**
(reported in-session), from the repo file at
`md5 88297fc6f2624db194d3249a5155c79e` (LF line endings — a Windows
checkout hashes differently until `
` is stripped). That commit narrowed
`scoring_config` write to the new `isScoringAdmin()` (Ammar). **No
republish is outstanding as of that commit**; this supersedes the entries
below.

**Republished a fourth time by Ammar on 17 Sept 2026, after PR #71**
(reported in-session), from the repo file at
`md5 0f6d62e739f5f66eac1c5010efbafbf6` — `git log --oneline -1 --
firestore.rules` is the PR #71 commit (`creators` delete widened from
`isOwner()` to `isMarketing()` so the Content Ops lead can delete
creators). **No republish is outstanding as of that commit**; this
supersedes the entries below.

**PUBLISHED 18 Sept 2026, was outstanding (18 Sept 2026):** two rounds, both waiting.
The field round — `dispatches` gained `'on_hold_stock'` on create and
update, `paid_pr_requests` delete now allows the requester as well as an
owner (still pending-only), and `marketing_settings` is a new collection.
Then the dispatch delete — `dispatches` delete went from a bare
`isOwner()` to `isMarketing() && type == 'organic'` with no discount code,
which both widens (the lead can tidy the log) and NARROWS (nobody can
delete a Paid PR dispatch or one a code points at). Until the Console has
it: putting a dispatch on hold, withdrawing a request, deleting a dispatch
and saving the niche tag list are all refused.

**No republish outstanding as of 18 Sept 2026.** Afnan confirmed
("rules done") from the repo file at `md5
e021956a095f27489364830576986683`. That one paste carried FOUR rounds at
once: Pattern Hub M3+M5+M6 (`pom_templates`, `patterns/{id}/revisions`,
`pattern_notices`, `isPatternCutting()`, `settings`), Mood Boards Trash
(`mood_boards/{id}/trash`), and the Marketing blocks. Check `git log
--oneline -1 -- firestore.rules` against that md5 before assuming either way.

**SUPERSEDED 29 Sept 2026 (evening) by the FINAL-file entry near the top — its file
(`acc9a3a1…`) was reported published by Afnan, then `main`'s own file was
reported published after it, and what to publish now is the FINAL file.
Was: REPUBLISH OUTSTANDING (28 Sept 2026, late; still open 29 Sept) —
publish the MERGED file, and only the merged file.** Three things were
waiting, and they were one paste.

1. **Master Accounts M1.6a (`704056b`) changed `firestore.rules`** — LF
   `md5 f2f8de5e67a742c709c4d0835c56ecab` (verified: `git show
   704056b:firestore.rules | md5sum`; M1.6b, `20260a0`, left it untouched,
   and so did M1.6c's `7735410` and `8e5fe0b`) — **and V3 (`0a0df4b`, 29
   Sept) changed it again:** codes, amounts, a count's shape, the edit
   row's clock window and field list, and `historical` against `goLive`
   are checked at the rules now (Master Accounts, decision 2).
   Edits and confirmations are held at the rules now: a transfer's
   confirmation comes from one holder-to-person map (`maHands()` /
   `maDrawers()`), a create may carry no `confirmed*`, `reviewed*` or
   `voided*` key, an edit never moves a status or a confirmation and names
   `amount` and `tax` when it moves them, `month` and `fy` are bound to the
   date, only real months and days pass, an edit stores its own flags and
   clears the review when a figure moved, confirm and review are refused in
   a locked quarter, a close is born locked with an audited re-lock, an
   `ma_audit` row must be stamped within five minutes of the server's clock,
   and `ma_shares` takes no client write. See "Master Accounts" for why each.
2. **The two pastes of 28 Sept cannot both be live.** Afnan reported
   publishing the Master Accounts rules (`1d8b3c5`, entry below) — and
   main's record (`bb836a4`, "No republish outstanding as of 28 Sept 2026
   (evening …)", two entries down) has him publishing main's file
   (`430fc28`, Mood Boards sharing roles, `md5
   b68fc9febc14ec90ad3d29f860147702`) at ~10:10 pm PKT (17:10 UTC) the same
   day. **Before the merge, neither file carried the other's change:**
   checked across every local branch and remote ref, none held a
   `firestore.rules` with both `isMasterAccounts()` and
   `boardSharingUntouched()` (re-checked 29 Sept: today only the merge
   `1dc7fa9` and the commits built on it do). The Console keeps whichever
   was pasted LAST, and only its rules history (Firebase Console →
   Firestore → Rules) can say which. The Master Accounts publish is
   recorded nowhere with a time, so the order is not known from here. The
   session that built M1.6a (committed 16:45 UTC) reported it as already
   done — reported, not recorded — which, if right, puts main's paste
   second.
   - **If main's paste was last:** the Console has NO `ma_*` rules, so
     every Master Accounts read and write is default-denied — to Afnan and
     Ammar too. Each page shows *"Could not read … — republish
     firestore.rules with the Master Accounts block"* and the dashboard card
     *"Could not read …"*. Nothing is lost: nothing could be written.
   - **If the Master Accounts paste was last:** main's sharing roles are
     gone again — a view-only person on a board can edit it, and anyone on
     `sharedWith` can rewrite `sharedWith` (main's entry "REPUBLISH
     OUTSTANDING (28 Sept 2026): Mood Boards sharing roles").
3. **Main's QA identity is outstanding too** (main's own entry below,
   "OUTSTANDING (26 Sept 2026, evening): the QA identity") and arrived on
   `main` with PR #91 (`e1f84bf`) — so main's file itself changed again
   after the 28 Sept evening paste: at `e1f84bf` it is LF md5
   `20e3002f5f6cbb142833e173c44388e9`, 1,118 lines, with the QA fences and
   still no `ma_*` block (the same bytes at `bac4848`, `d1af808` and
   `5996999`; main's file changed after that, in the QA-read work — at
   `08b530a` it is `7d858a05…`, 1,142 lines).

**Do not paste an older branch file, or a `main` from before the merge.**
An older branch file reopens the Mood Boards hole and lacks the QA fences;
`main`'s file before the merge removes Master Accounts. **The file this
entry named, when it was written, was `firestore.rules` at the branch's tip
then: LF `md5 acc9a3a1cec525ee4e1d335da30124fe`, 1,502 lines — the file
Afnan reported publishing on 29 Sept, and no longer the file to publish
(the FINAL-file entry near the top: the final file adds `main`'s QA-read rules)** —
main's 1,118 at
`e1f84bf` plus the Master Accounts block with M1.6a and V3. It came from
the fifth merge of `origin/main` into the branch, `1ae7e71` (29 Sept), which
merged the rules without a conflict: the file equals an independent `git
merge-file` of the three versions, and a line-multiset check (merge base
`dc0e609`'s 1,016 lines + the branch's 384 + main's 102 = 1,502) matches
every line; no later commit touched the file until the ninth merge — not
the docs commits, the F25–F27 follow-up, or the sixth, seventh and eighth
merges (`5a36efe`, `672cf4f`, `69f5c72`): `bac4848`'s, `d1af808`'s and
`5996999`'s rules equal `e1f84bf`'s. **The ninth merge (`ef7eabb`, `main` at
`08b530a`) changed it: main's QA-read work, and the file is now `9d7ec162…`
(the FINAL-file entry near the top).** The earlier
merged file (`1dc7fa9`, LF `md5 8cf1c6813fe0becddd620161ba0277f4`, 1,346
lines) was never the one to publish, and is superseded. Main's record names
the Firebase CLI as the publish route now: it deploys the checkout it runs
in. From a checkout of `main` at or after the merge of this branch that is
the final file, with the Master Accounts block; from a checkout of `main`
before it, it would take the block out again.

What each state of the Console refuses, so a report can be read against it:

- **Under `1d8b3c5`'s rules** (the Master Accounts paste reported on 28
  Sept), the app's own writes that are refused: **an edit that stores the
  flags it raised** and **an edit that clears a review** (the old
  `maEditOk` lists neither `flags` nor `reviewedAt` / `reviewedBy`), and
  the re-lock of a reopened quarter, which no M1 screen offers. And those
  rules still ALLOW what M1.6a and V3 closed — a forged transfer born
  confirmed, an edit that moves money unnamed, a client-written share link,
  a back-dated audit row, a code that is a number, a negative amount; until
  the publish, those hold in the app only. Verified in the emulator: the
  check file at `1ae7e71` run against `1d8b3c5`'s rules fails **84** — 55
  "M1.6a:" attacks, 21 of the 22 "V3:" attacks and 8 of the app's own
  writes (Master Accounts, "What is verified").
- **Under the FINAL file (`9d7ec162…`, the one to publish):** 241 / 241
  for Master Accounts, 103 / 103, 100 / 100 and 26 / 26 for main's own
  suites, and 604 / 604 (`rules-emulator-qa.js`), 9 / 9, 5 / 5 and 31 / 31
  for main's QA suites — the merge agent's runs, read from its logs, on
  `8573391`'s tree (the file is byte-identical at the tip). Everything the
  next bullet says about the merged file holds for it too.
- **Under the merged file Afnan reported publishing (`acc9a3a1…`):** 241 /
  241 in the emulator, and main's own suites 103 / 103, 100 / 100 and
  26 / 26. The app writes an
  `ma_audit` row in the same transaction or batch as every change, and the
  rules refuse a row — and, since V3, an edit's own row — more than five
  minutes from the server's clock, so **a device whose clock is more than
  five minutes off has every Master Accounts write refused**, and the error
  says to check the clock. The rules do not require the audit row beside a
  document write; the pairing is the client's. A stored document with a
  NUMERIC holder code would be refused on its next edit (V3 wants strings);
  the app writes strings, and no build of the branch was deployed before the
  merge into `main` (29 Sept).
- **Under main's rules (no `ma_*` block), at any of its versions —
  including `7d858a05…`, the file Ammar reportedly published on 29 Sept
  evening:** see above — Master Accounts reads nothing. `main`'s file
  itself became the final file with the merge of this branch.

On the branch today `git log --oneline -1 -- firestore.rules` names
`ef7eabb` (the ninth merge), and `9d7ec162b9812b5358d2ce07a400824a` is what
to check the file against (`acc9a3a1cec525ee4e1d335da30124fe` was the file
until then).

**Master Accounts rules reported published by Afnan, 28 Sept 2026**
("rules updated" — reported in-session; not recorded in any commit, and not
checkable from here) from the branch file at `md5
d7480d88469878d082d841ba995f3960` (`1d8b3c5`, LF — verified: `git show
1d8b3c5:firestore.rules | md5sum`; unchanged through `4057303`). The app's
first owner-only reads: `isMasterAccounts()` = `afnan@groovy.op`,
`ammar@groovy.op` guards every `ma_*` collection — reads included — with
writes bound to the caller, no client delete, edits that grow `edits[]` by
one row naming the changed fields, voids and confirmations as transitions,
the quarter lock read from `ma_closes`, an append-only `ma_audit`, and
server-only `ma_backups`. Run in the emulator before the paste (105 checks,
per the commit message). If the whole file was pasted — Afnan's standing
preference — it also carried every entry below still marked REPUBLISH
OUTSTANDING (The Board's lock rule, the warehouse handover and its review
round, Raees's edit rights, Ammar's `isAcctSuper()`): all of them are in
that file (verified: their commits are ancestors of `1d8b3c5`, and the file
holds `tbLockOk`, `whConfValid`, `acctOwnEdit` and an `isAcctSuper()` that
names `ammar@groovy.op`). Main's own entry claims the same for its paste.
**SUPERSEDED the same day** — by M1.6a, and by the collision above.

**No republish outstanding as of 28 Sept 2026 (evening, ~10:10 pm
PKT).** Afnan published ("done", after a reload showed the new version and
`boardSharingUntouched` in the live editor — reported in-session, not
checked from here) from the repo file at `md5
b68fc9febc14ec90ad3d29f860147702`, `git log --oneline -1 -- firestore.rules`
= `430fc28`. That one paste carried EVERY outstanding entry below: the Mood
Boards sharing roles, The Board's lock rule (`tbLockOk`), the warehouse
handover and its review round, Raees's edit rights, and Ammar's
`isAcctSuper()`. The entries below are history now.

**REPUBLISH OUTSTANDING (28 Sept 2026): Mood Boards sharing roles.**
`mood_boards` update now requires the editor role and keeps the sharing
fields to the board's owner; comments/activity accept the comment role.
Until the Console has it, a view-only person can still edit (the app hides
the tools, the rules do not stop a direct write) and the old sharedWith
escalation stays open. Ran 26/26 in the emulator. One paste of the current
file carries every outstanding entry below as well.

**SUPERSEDED 29 Sept 2026 (evening) by "No republish outstanding as of 29 Sept
2026 (evening) — the QA-read rules are LIVE" above; the text below is kept as it
was.** Ammar reportedly published `isQaRead()` and the uid pin from the repo file
(reported, not checkable from a session); the live probe of 29 Sept behaves as
those rules describe (behaviour only — "QA debug access"); the Auth account
exists and signs in (same section); and the branch is no longer unmerged —
verified 30 Sept: `dc98484`, `b680d0b`, `b1872f4` and `08b530a` are ancestors of
`origin/main`, and no `qa-access*` remote branch exists (`git ls-remote --heads
origin 'qa-access*'`, `git branch -r`). *Was:*

**OUTSTANDING (26 Sept 2026, evening; extended 29 Sept 2026): the QA identity**
(`dc98484`, `isQa()` / `authed()` / the QA fences — see "The QA identity" in
`BOARD.md`, and `QA_ACCESS.md` for the rest). `signedIn()` EXCLUDES
`claude@groovy.op` for writes. **29 Sept 2026 (branch `qa-access-v2`,
unmerged): QA READS EVERYTHING** — `isQaRead()` is OR'd into all 91 read
rules, role-gated and owner-only included; the credential collections keep
no match block; `database.rules.json` is unchanged. **And main's
notification fence had a hole** (`forUser:'claude'` + `forRole:'owner'`
reached every owner's bell) — `qaOwnNotice()` closes it. The published
ruleset (`md5 b68fc9fe…`, `430fc28`) has NONE of this, and ~~whether the Auth
account exists is unknown~~ *(SUPERSEDED 29 Sept 2026: it exists and signs in — "QA debug access")*: see `QA_ACCESS.md` §1 for the Console check and §5
for the rollout and rollback. **Publish before anything signs in as that
account.**

**PUBLISHED 26 Sept 2026, was outstanding (session 2): The Board's lock
rule** (`tbLockOk()`, `board_items` update). The old clause let a member on
a locked item re-point `lockedBy` at themselves (or set `locked:false`) and
then move the date, and refused a non-owner locker their own unlock --
found by running the Board rules in the emulator for the first time
(`tests/rules-emulator-board.js`, 39/39 after; the old rule fails 3). One
paste of the current file carries this AND every outstanding entry below.
**The Board's phase-1 rules (`board_*`) are in the same file; if they were
never published, the Board shows "could not read" to all five of its
users, and it is their landing page.**

**PUBLISHED 26 Sept 2026, was outstanding (later): the warehouse handover,
and its review round.** `wh_sales` read now includes `isStoreAccounts()`,
and a new update clause lets Umair mark a pay-later bill collected. Until
the Console has it, Raees's ledger shows "Warehouse sales could not be
read" and Umair's *Mark collected* is refused. **The review round changed
the file again** (`whSaleValid` checks the date, a collection is set only
on an uncollected bill, `whConfValid` on `acct_entries` create) — publish
the NEWEST file; an older paste is missing those. **The same paste carries Raees's edit rights below
if that one was not published yet.**

**PUBLISHED 26 Sept 2026, was outstanding: Raees's edit rights.**
`acct_entries` update now splits into `acctControl()` / `acctReview()` /
`acctOwnEdit()` (see Store Accounts, "Raees can EDIT his own entries").
Until the Console has it, Raees's **Edit…** is refused with "Missing or
insufficient permissions" — and the old ruleset still lets him clear a
review flag through the control list. Ran 77/77 in the emulator. **If the
25 Sept republish below was never done, this one paste carries it too.**

**PUBLISHED 26 Sept 2026, was outstanding (25 Sept 2026):** `isAcctSuper()` now lists
`afnan@groovy.op` AND `ammar@groovy.op` (it was Afnan alone). Until the
Console has it, Ammar sees the Store Accounts admin buttons (Edit / Delete
an entry, Delete vendor, Reopen, Reset) but every one of their writes is
refused with "Missing or insufficient permissions". **Then, the same day,
`isWhSales()` and `match /wh_sales/{orderNo}` (warehouse sales) were
added** — until they are published, Umair's Accounts section shows its
"could not be read" card and every save is refused. **The `wh_sales` block
changed AGAIN the same day** (the review round: `whSaleValid()`, recording
a bill again over a void, and the who-bindings) — so a paste of the file
taken BEFORE that commit is missing them; the newest file is the one to
publish. One paste carries all three. It was run in the Firestore
emulator (`tests/rules-emulator.js`, 32/32) before it was handed over.

**No republish outstanding as of 23 Sept 2026 (evening).** Afnan
confirmed ("rules pushed") from the repo file at
`md5 8b9db4a06a677f3bd022044b75ed5145` — `git log --oneline -1 --
firestore.rules` is `b084a47`: a new `isAcctSuper()` (`afnan@groovy.op`
alone) and, gated on it, `acct_entries` update without the field
allow-list plus delete, `acct_closes` delete and `acct_vendors` delete —
the Store Accounts correction tools (Edit / Delete on an entry, Reopen and
Reset on Review & close). Nothing else in the file moved. The Console's
acceptance was reported by the human; it could not be checked from a
session. If an admin action is still refused after this, check the
signed-in Auth email is exactly `afnan@groovy.op` before reopening the
code. This supersedes the afternoon entry below.

**No republish outstanding as of 23 Sept 2026 (afternoon).** Afnan
confirmed ("published") from the repo file at
`md5 d2683e26b4199e8637e57f339edf7e8e` — `git log --oneline -1 --
firestore.rules` is `714166a`: `acct_settings` went from `allow write: if
isOwner()` to a field-limited create/update for `isStoreAccounts()` (only
`categories, updatedAt, updatedBy`), so Raees's "+ New category…" now
saves the list. The Console's acceptance was reported by the human; it
could not be checked from a session. This supersedes the morning entry
below.

**No republish outstanding as of 23 Sept 2026 (morning).** Afnan confirmed
("published") from the repo file at `md5 fdd5c186a696f66f30120436f356e7af`
— `git log --oneline -1 -- firestore.rules` is `48fca7e` (Store Accounts:
`acct_entries`, `acct_vendors`, `acct_meter_logs`, `acct_settings`,
`acct_closes`, `isStoreAccounts()`; the six `store_cash_*` blocks went from
open write to owner-only). The Console's acceptance was reported by the
human; it could not be checked from a session. If a Store Accounts write
is still refused after this, that is new evidence — check Raees's Auth
email is exactly `raees@groovy.op` before reopening the code.

**Known mismatch, deliberately parked** (Afnan: "leave daniyals ituation for
rn"): `isContentOpsLead()` lists `daniyal@groovy.op`, while this file
records Daniyal's login as `daniyaltufail59@gmail.com` — the one account on
a real inbox rather than `@groovy.op`. If that is right, his Marketing reads
are denied despite the republish, and the Creator Database shows its rules
error card. It is Ammar's file: raise it, do not edit it.

**Corroborated live, same day: Save measurements on a block failed with
"Missing or insufficient permissions."** for Afnan (an owner), screenshot
in-session. Read from the code before answering: `window.ptnSaveGrid`
writes only `{grid, gridUpdatedAt, updatedAt, updatedBy}` to
`patterns/{id}` via a plain `updateDoc` — it never touches `code` or
`createdAt` — and the repo's `patterns/{id}` **update** rule
(`isPatternAdmin() && code unchanged && createdAt unchanged`) is
**byte-identical from the M2 commit (`db8aefd`) through M6 (`af132bc`,
current)** — checked with `git show <rev>:firestore.rules`, not assumed.
So the repo rules already permit this exact write for an owner; a live
`PERMISSION_DENIED` on it is not explained by anything in this file or in
`js/patterns.js`. It matches exactly what a stale/never-fully-published
ruleset would produce, and is consistent with — not proof of — the
outstanding-republish note above. **Not verified from this sandbox**: what
the live Console rules actually contain (~~`*.firebaseio.com` is
unreachable here~~ *SUPERSEDED 29 Sept 2026: that host answers — and it is the RTDB host, not the
Firestore rules; the rules TEXT is still not readable from a session, but the QA account can
probe how the live rules answer*) — only Afnan republishing and retrying can confirm it.
If "Missing or insufficient permissions" is reported again on ANY Pattern
Hub write after a fresh republish, treat that as new evidence and reopen
the code, not just the rules.

**Republished a third time by Ammar on 16 Sept 2026, after PRs #65/#66**
(reported in-session), from the repo file at
`md5 d6fb1e99e99cf9575e275f973c68f47e` — `git log --oneline -1 --
firestore.rules` is `5bd5494` (Marketing M4: `discount_codes`, the
dispatch code-link guard). **No republish is outstanding as of that
commit**; this supersedes the two entries below.

**Republished again by Ammar on 16 Sept 2026, after PR #63** (reported
in-session), from the repo file at `md5 1910baa80876acfebd09d46b68e7d8e3` —
`git log --oneline -1 -- firestore.rules` is `d9a488c` (Marketing M7: the
blank dispatch status). **No republish is outstanding as of that commit.**

**Republished by Ammar on 16 Sept 2026** (reported in-session, after PR
#61), from the repo file at `md5 5211506e56a03d345ba061be46ea6a20` —
`git log --oneline -1 -- firestore.rules` is `60f8ccb`. That one paste
covered everything that had been waiting: the Mood Boards Trash
(`71b4acb`) and Marketing M1–M3 (`creators`, `creator_handles`,
`scoring_config`, `dispatches`, `paid_pr_requests`, `isContentOpsLead()`
with `daniyal@groovy.op`, `isPaidPRApprover()`). **No republish is
outstanding as of that commit** — superseded by the `d9a488c` publish
above; check against that one. The Console's acceptance was
reported by the human; it could not be checked from a session.

**Keep updating both in lockstep**, per the comment at the top of
`firestore.rules` itself. **The trigger to ask for a republish is a change
to `firestore.rules` in the repo — check `git log -- firestore.rules`
against the last republish recorded here rather than assuming either way.**
`tests/invariants.test.js` catches the related mistake (a collection the
client queries with no `match` block at all) but it cannot know what the
Console currently holds; only the human can confirm that.

**Known gap, not yet closed:** `payslips` reads are `if signedIn()` — any
logged-in user, not just the employee it belongs to, can read any payslip.
The rules file's own comment flags this: tightening to per-employee
self-read needs the auth email denormalised onto each payslip doc first
(no `employeeId` → `session.email` link exists yet to check against).
Employee-record writes and payroll processing are already owner/manager
gated; this is the one remaining read-scope hole.

## Diagnostics — never a blank screen (Sept 2026)

**Written after a real incident.** Profiles shipped with
`await profileBootstrap()` on the critical path in `startApp`, before
`buildNav()` and `showPage()`. A Firestore `getDoc` that never **settles** —
not one that rejects; a rejection was handled and rendered fine — parked
`startApp` forever, so neither ever ran. The topbar painted and everything
below it stayed white. It reached production and blocked the business.

Two rules came out of it, and both are enforced by tests now:

1. **Nothing on the path to the first render may wait on the network.**
   `tests/smoke-startapp.js` runs the real `startApp` in a browser with
   reads that resolve, reads that are denied, and reads that never settle,
   and requires the app to render in all three. Put an `await` back in front
   of `buildNav()` and the third case fails.
2. **A person looking at a broken app must be told what broke.** On a phone
   there is no console without a cable and a laptop, so a white page is
   unfixable by the person in front of it.

`js/diagnostics.js` is that second rule:

- **Errors are captured from the very first byte.** A tiny inline snippet in
  `index.html`'s `<head>` seeds `window.__gvErrors` *before any script tag*,
  so a script that fails to **load** is recorded too — including
  `diagnostics.js` itself. It listens in the capture phase, because a failed
  `<script>`/`<img>` fires on the element and never reaches `window`.
- **A watchdog** checks at 12s and 30s: if `#scr-app` is visible but
  `#main-content` is still empty (and no `.board-canvas-wrap` has taken the
  viewport), it shows a panel naming what happened, with the recorded
  errors, build id, service-worker state and online status.
- **"Clear the app cache and reload"** deletes every Cache Storage entry and
  unregisters the service worker. A phone stuck on a bad cached build cannot
  be fixed by reloading — the worker keeps serving the old precache — and
  this is the only self-service escape. It deliberately does **not** touch
  Firestore's IndexedDB, so queued offline writes survive.
- **"Copy details"** puts the whole report on the clipboard to paste into a
  session, with a `document.execCommand` fallback where the async clipboard
  is refused.
- The panel is **plain HTML with inline styles** and its details are written
  in with `textContent` — it has to work when `css/main.css` is itself the
  thing that failed, and an error message can contain anything.
- `window.__gvDiagnostics()` opens it on demand; `window.__gvResetApp()` is
  the reset on its own.

**If a blank screen is ever reported again, ask for the panel's "Copy
details" output first.** That is what it is for — it beats reproducing the
failure somewhere else, which is what this incident cost.

## Tests and CI (Sept 2026)

```bash
node tests/run.js            # everything
node tests/run.js boards     # one suite
```

`tests/` holds plain-node suites — no dependencies, same zero-new-deps
policy as the app — and `.github/workflows/tests.yml` runs them on every
push and pull request, for both tracks. 261 assertions at the time of
writing. `tests/README.md` explains how to add one.

**Read this before trusting a green run.** Most of these tests prove the LOGIC
still holds: validators, sanitisers, maths, what a menu offers, what gets
written to Firestore, whether a loader can reject. `smoke-layout.js` (Sept
2026) adds one narrow kind of visual proof — it measures rendered geometry
and fails on text with nowhere to go — but it only covers the fragments
listed in its `FRAGMENTS` map, and it cannot tell you whether a page looks
GOOD, only that its content has room to exist. Nothing here would have
caught the board's entire top bar being invisible for weeks behind a wrong
`z-index`. Real UI verification still needs a human, a phone, or Claude in
Chrome.

- **`tests/harness.js`** — one shared stub of the handful of browser APIs
  the modules actually touch, plus the window-bridged Firebase globals.
  `loadApp({files, session, phone, currentPage, globals})` loads classic
  scripts into a `vm` context and hands back `run()`, `el()` and the
  recorded writes/toasts/vibrations. `globals` overrides anything, which is
  how a test makes `getDocs` throw to exercise a failure path. **Its
  `DOMParser` is a tag-soup stub** — it is good enough to exercise an
  allow-list walk, but an assertion about parsing itself is testing the
  harness, not the app.
- **`tests/invariants.test.js`** — the documented footguns, encoded. Every
  `js/*.js` has a `<script>` tag in `index.html` AND an entry in `sw.js`
  `PRECACHE_URLS` (the "three places or it breaks offline" rule); nothing
  precached is missing from disk; `USER_DEFS` carries no `pass:` and no
  service-account key or Shopify secret is in a served file; everything
  parses and `css/main.css` / `firestore.rules` balance; the browser still
  imports no RTDB write function and `database.rules.json` still denies
  client writes; **every collection any `js/*.js` queries has a
  `firestore.rules` match block** (the Stage 6 failure mode that left the
  gallery stuck on a skeleton); and the staged-rollout gate is
  all-or-nothing.
- **`tests/smoke-browser.js`** — loads every classic script from
  `index.html`, in the real load order, in real headless Chromium, and checks
  they execute and define what the rest of the app expects; then makes jsPDF
  write a PDF, SheetJS write a workbook and JsBarcode draw a barcode. It
  catches what `node --check` cannot: a load-order break, a top-level `const`
  declared twice across two classic scripts (they share one lexical scope), a
  global that quietly stopped being defined. **Only possible because the
  libraries are vendored.** ~~It still cannot sign in — gstatic is blocked, so
  `__bootApp()` never runs~~ *(SUPERSEDED 29 Sept 2026: the gstatic premise is false. This
  suite still does not sign in, and that is by design: it serves a synthetic `/__probe` page that
  lists the classic scripts — not `index.html`, so no Firebase module is imported and
  `__bootApp()` never runs — and launches Chrome with `--no-proxy-server`, so it reaches
  127.0.0.1 only (read from `tests/smoke-browser.js`). Signing in is `tests/e2e/board.e2e.js`'s
  job, outside `tests/run.js` and CI — see "Sandbox limits")*. Skips cleanly with no browser. Note it runs the
  browser **asynchronously on purpose**: this process is also the web server,
  and a synchronous spawn deadlocks the event loop that has to answer the
  browser's requests — which looks exactly like a browser problem and is not.
- **`tests/smoke-startapp.js`** — runs the real `startApp` in a browser
  against a stubbed Firebase bridge under four conditions: reads resolve,
  reads are denied, **reads never settle**, and the app stalls. The first
  three must render; the fourth must raise the diagnostics panel. This is
  the regression test for the white-screen incident — see "Diagnostics"
  above. Verified both ways: green with the fix, and failing the `hang` case
  with the `await` restored.
- **`tests/smoke-layout.js`** — the only thing in `tests/` that can SEE a
  page. Since Sept 2026 it also **measures contrast**: every element
  carrying text, against its effective background, in both themes, failing
  below **2.2:1**. Deliberately low — this is not a WCAG audit, and a
  stricter bar would flag every piece of muted helper text and drown the
  finding; 2.2 is "a human cannot read this at all". It caught the dark-mode
  toggle chips AND a bug nobody was looking for (a profile name colour at
  1.76:1 in dark). **Two traps when editing the PROBE, which is a template
  literal: a backtick in a comment CLOSES it, and `\d` collapses to `d` —
  the regex then matched nothing and the check silently passed everything.
  Verify a new check by raising its threshold until it fails, or you are
  testing nothing.** It renders real markup from the real modules, serves it with the
  real stylesheet in headless Chromium, and **measures** it at 1900/1280/420
  px in both themes, failing on any element that carries text but occupies
  **zero width**, any box that overflows itself, any page that scrolls
  sideways, and — since Sept 2026 — any **clickable element that the browser
  could not actually reach**: zero-sized, `pointer-events:none`, or covered
  by something else when `elementFromPoint` hit-tests its centre. That last
  check is the one that matches nearly every UI bug this app has had (the
  board's top bar behind a wrong `z-index`, the delete ✕ retargeted by a
  pointer capture, the profile photo with no handler). **A hit is only OK
  when it IS the control or a descendant of it** — an ANCESTOR counts as
  covering, which is how an `::after` overlay swallows its own children; the
  first version exempted ancestors and therefore caught nothing, found by
  deliberately covering a button. It exists because the Profile directory shipped with the
  person's name and the action buttons in one flex row inside a 220px grid
  tile: the buttons are `flex-shrink:0` and the name is `flex:1;min-width:0`,
  so **every name rendered at exactly 0px** and no row said whose profile it
  was — while every logic suite stayed green, because the name was in the
  DOM the whole time. Verified both ways: it fails on the pre-fix code
  naming the exact elements, and passes on the fix. **Add a fragment to
  `FRAGMENTS` when a page grows a layout worth protecting** — it is cheap,
  and this class of bug (see also the board's z-index) has cost this app
  more than any logic error.

  **A fragment that declares `heights` is measured inside an IFRAME of
  exactly that viewport (Sept 2026), and it took a CI failure to learn
  why.** `--window-size` sets the WINDOW; how much of it the browser keeps
  is per-build. At a 768px window this sandbox left `100vh` at 681 and the
  GitHub runner left 647, so the tool rail measured `client:631` here and
  `client:575` there — and the rail check, which says the rail must never
  need vertical scrolling, **failed only on CI, on every push, while
  passing locally.** It was measuring the runner's chrome. Framed, the
  stage is exactly `h - 50` (950 and 718) on every machine. `tests/
  smoke-phone.js` had already solved this the same way and said so in its
  header; `smoke-layout`'s `heights` feature simply never adopted it.
  Verified both ways by forcing a 620px window: the pre-fix code fails all
  eight rail jobs at `scroll:623, client:483`, the fixed one passes all
  eight. **Cost, stated rather than buried:** the old 631 was smaller than
  the truth, so the check used to fire at 13 tools (673 compact) and now
  fires at 14 — still a real guard, just no longer accidentally strict.
  **And it was red for a while before anyone looked** — `410af08` failed
  "4 of 206" before that day's five pushes, each of which went onto an
  already-red CI. **Check the check-runs on a push, not just the local
  run; "green here" is not the claim CI makes.**

  **A job whose probe NEVER RAN is retried once, with double the
  virtual-time budget (27 Sept 2026).** CI on `main` failed "the board —
  item drawer @ 1280px light — the probe never ran" with no error text
  (Chrome exited normally, no result), while the same commit passed on the
  branch run and the fragment passed 5/5 locally; the session could not
  re-run the job (GitHub 403). Only a MISSING answer is retried — a probe
  that ran and reported a finding never is. Verified both ways: a dropped
  first answer recovers on the retry, and a probe that never answers still
  fails all six jobs.

  **OPEN, and deliberately not decided by picking a number:** what a
  768px-tall LAPTOP really leaves. This file puts a 900px screen at ~790px
  of viewport, i.e. ~110px of OS and browser chrome; the same subtraction
  makes a 768px screen ~658px of viewport and a ~608px stage, which the
  623px compact rail would NOT fit. If that subtraction is right, the rail
  overflows the shortest screen we claim to support. That is a product
  question about the shortest supported screen, so it is flagged here
  rather than answered in a probe setting.
- **`tests/smoke-app-phone.js`** (27 Sept 2026) — the WHOLE app on a
  390px phone: the real `index.html` shell and scripts, signed in through
  the in-memory Firestore (`STUB`/`CLOCK` are read out of
  `tests/smoke-board.js`, not copied), inside an iframe of the real width
  (the `--window-size` clamp). Owner in both themes on 46 pages, plus a
  worker, viewer, store, fulfilment, Marketing and CSR account. Fails on:
  the page scrolling sideways, anything laid out past the right edge
  (outside a strip that scrolls on purpose), text under 2.2:1 (text over a
  gradient is skipped — the probe cannot read one), a `.btn-sm` /
  `.btn-outline` / `.filter-chip` / `.dest-chip` under 34px, the toast
  resting on the bottom nav, and anything thrown. **What it does NOT hold,
  checked:** a label that breaks mid-word (the Dashboard's stage tiles —
  the text is still visible) and the Users row pushing its button off the
  screen (the card clips it rather than letting it overflow the page).
  Verified by undoing the toast, the dark KPI tiles and the tap-target
  rule one at a time: each fails by name.
- **`tests/check-cache-version.js`** — a CI guard rather than a suite,
  because it needs git history. If a precached file changed between the base
  ref and HEAD, `CACHE_VERSION` must have changed too. Forgetting it fails
  *silently* in production — nothing looks wrong, the change simply never
  reaches anyone who already opened the app — which is exactly why it is
  worth a hard failure in CI. It abstains rather than inventing a failure
  when there is no comparable history (a shallow clone, a first commit).

**These suites were promoted from throwaway session scripts, and they have
already earned it:** they caught the `window.session` bug that would have
made board reactions silently record nothing, a duplicated menu entry, and
the wrong gate count in this very file. **Earlier stage-specific harnesses
(Stages 4-6: the save merge, the comment XSS boundary, the allSettled
loaders) have NOT been ported yet** — porting the ones worth keeping is
open work, not something already done.

## Branch / merge workflow

- Each task is on a `claude/<task>` branch, then fast-forward into `main`
  and pushed. Sandbox cannot delete remote branches (HTTP 403), so feature
  branches accumulate on GitHub. Clean up at:
  https://github.com/afnanbit2-bit/Groovy-Operations/branches
- Ammar's track uses GitHub PRs (#9 through #16, #23 so far) merged to main.
- Both tracks push to the same `main`; Netlify deploys main automatically.

## Running locally

The app is now multi-file (`index.html` shell + `/css/main.css` + the
`/js/*.js` scripts), but there is still **no build step** — the files are
served as-is. `python -m http.server` from the repo root still works
exactly as before; open `http://localhost:8000/` (serving from the repo
root is required so the absolute `/css/...` and `/js/...` paths resolve).
The Firebase config in `index.html` points at the live `groovy-gatepass`
project, so any local writes hit the same Firestore as production. Read-only smoke tests are safe; destructive
flows (process payroll, mark paid, approve advances, mark bug fixed)
are NOT — they mutate live data.

- **Returns banner removed (1 Oct 2026, v286, branch `claude/affectionate-volta-1dtjzy`):** at Afnan's request ("this is not required") the amber returns-gap banner on the Article Explorer and the Needs Attention amber "Returns are not synced" item are gone. Detection, the Medium confidence cap and all figures are unchanged; a quiet grey "Returns not yet synced" note sits in Data quality / Data checks. The figures are still upper limits until the returns refresh has run. Stale-snapshot and other trust banners are untouched.

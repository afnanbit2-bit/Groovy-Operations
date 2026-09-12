# Groovy Operations — Claude session notes

Multi-file SPA, deployed to Netlify on every push to `main`.
Two contributors: Afnan (HRM/operations side, with Claude) and Ammar Shah
(printing/embellishments side, also with Claude on a separate session).

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
| Deploy status + the **real** preview URL | GitHub MCP `pull_request_read`, `method:"get_status"` — returns Netlify's own `target_url` and pass/fail |
| CI / check-run detail | `pull_request_read`, `method:"get_check_runs"` |
| Whether something is merged | `git fetch` then `git merge-base --is-ancestor`, or `pull_request_read` `method:"get"` (`merged` field) |
| Static files serve | `python3 -m http.server` at repo root + `curl -o /dev/null -w "%{http_code}"` |
| JS parses | `node --check <file>` |
| `netlify.toml` valid | `python3 -c "import tomllib;tomllib.load(open('netlify.toml','rb'))"` |
| `manifest.json` valid | `python3 -c "import json;json.load(open('manifest.json'))"` |

### Sandbox limits (verified, reproducible)

The Claude sandbox **cannot reach `*.netlify.app`** — the egress proxy
answers `403` to `CONNECT` (`connect_rejected`). The deployed site can
therefore never be opened from a session. Check deploys via the GitHub
status API above, and depend on the human for anything needing a real
browser: install prompts, offline behaviour, visual confirmation.

The sandbox **also cannot reach `*.firebaseio.com`** (same `connect_rejected`
403), so live Realtime Database rules can never be verified by curling the
REST endpoint from here — despite `firestore.googleapis.com` itself being
reachable. To verify RTDB rules actually took effect, use Firebase Console
→ Realtime Database → Rules → **Rules playground** (simulate an
unauthenticated read) and have the human report the result.
`api.github.com` and `firestore.googleapis.com` **are** reachable.

**Also blocked (verified Sept 2026, via both `curl` and a headless Chromium
launch — `CONNECT tunnel failed, response 403` on all three):**
`www.gstatic.com`, `cdnjs.cloudflare.com`, `cdn.jsdelivr.net`. This means
the app **cannot actually boot in a browser from this sandbox at all** —
the Firebase modular SDK loads from `gstatic.com` and jsPDF/SheetJS/
JsBarcode from the other two, so even an unauthenticated page load never
gets past the login screen's static HTML; `window.__bootApp()` never runs.
A "verify in a browser" step for any UI change therefore is not possible
from this sandbox — say so explicitly rather than skip the caveat, and
rely on `node --check` for syntax, a local `python3 -m http.server` +
`curl` for static-file serving, and manual trace-through for logic. Real
UI verification needs the human, a Netlify preview, or a session with
different network access.

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
/js/gatepass.js      gate passes, returns, fabric-in, GP edit/approval,
                     generateGPPdf, generateJobSheetPDF.
/js/fulfillment.js   Daily Performance track: per-day dispatch & returns
                     entry + analytics + date-wise Log (loadFulfillmentData,
                     renderFulfillmentPage). Firestore `fulfillment_reports`,
                     one doc per day (id = YYYY-MM-DD). Owners/managers +
                     the scoped `fulfillment` role (Umair). Per-day PDF via
                     the print engine `daily-performance` variant
                     (window.fulfillPdf).
/js/activity.js      activity log loader.
/js/notes.js         Notes / Wiki — Phase 1 of the Notion+Milanote module (see
                     "Notes / Wiki module" below). Block-based pages, personal
                     or shared. Shared/cross-track, like pos.js/gatepass.js.
```

Load order is fixed in `index.html`:
`shared → print-engine → auth → pos → embellishments → hrm → store →
gatepass → activity`, then the bootstrap module. All `/js/*.js` are **plain global classic
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
- PDF: jsPDF · Excel: SheetJS (both via CDN)
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
- **Network-first** (falls back to cache) — everything else, e.g. the
  jsPDF / SheetJS / JsBarcode CDN scripts.
- **Never intercepted** — Firebase (Firestore, RTDB, Auth, the gstatic SDK)
  and Cloudinary. These are matched by hostname in `BYPASS_HOSTS` and pass
  straight to the network. **Do not add Firebase or Cloudinary URLs to any
  cache** — stale auth tokens and half-cached writes are the result.

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

`/assets/icons/icon-{192,512}.png` + `icon-maskable-512.png` are the real
GROOVY wing/"G" mark (Sept 2026 — replaced the black/white "GO" placeholder).
Source: a 1920×1080 RGBA PNG the user supplied, transparent background,
mark itself ~880×484 after cropping to its alpha bounding box. Regenerated
with Pillow (`Image.alpha_composite`, `LANCZOS` resize) rather than by hand:
- `icon-192.png` / `icon-512.png` (`purpose: "any"`) — mark centered on a
  **transparent** canvas at 80% fill (by its longer dimension).
- `icon-maskable-512.png` (`purpose: "maskable"`) — mark centered on an
  **opaque black** canvas (matches `manifest.json`'s `theme_color`/
  `background_color`, both `#000000`) at a conservative **60%** fill, so it
  stays inside Android's ~66%-diameter safe-zone circle after masking.

To regenerate from a new source file: crop to `img.split()[3].getbbox()`
(the alpha channel's bounding box) before scaling — do not skip this, the
source file had ~800px of transparent padding on every side that would
otherwise throw off every fill-ratio calculation above.

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
  `/assets/fonts/FONT_INSTALL.md`. Known jsPDF limit: Urdu is drawn unshaped
  even with the JNN TTF embedded; also the ~10 MB JNN Regular is base64'd
  into every Urdu PDF, so those PDFs are large.
- **Public API (only global):**
  `window.printDocument({ type, data, filename })` where `type` ∈
  `po | embroidery-vendor | sublimation-vendor | gate-pass |
  placement-sheet | qc-report | generic`. **Implemented variants:**
  `generic` (fallback) and ✅ **`gate-pass`** (single-page bilingual
  transit document — `_renderGatePass`, dispatched via the `_VARIANTS`
  registry in `printDocument`). Any not-yet-built type logs a
  `console.warn` and renders the generic fallback (header + optional hero
  title + `data.bodyHtml` as text + bilingual footer). Opens the PDF in a
  new tab AND triggers download. The pre-opened tab shows a `_previewLoading`
  interim page (never a stark `about:blank`) during the font fetch/subset,
  and `_previewError` renders a readable failure page instead of a
  blank/closed tab. Remaining variant builders reuse the components below.
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
  Nastaleeq TTF is fetched + embedded. `'full'` fetches/embeds JNN and
  renders full bilingual output; `'minimal'`/`'none'` never download or
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
  English-only, never tofu. Font fetch is split (`_fontCacheCore` always,
  `_fontCacheUrdu` lazily only on the first `'full'`). Per-render the engine
  serializes the PDF once and logs `[print-engine] Generated {type} PDF —
  urduLevel: {level}, size: ~{X}KB`.

  | Default `urduLevel` | Types |
  |---|---|
  | `minimal` | `generic`, `payroll-sheet`, `payslip`, `daily-performance` |
  | `full` | `gate-pass` (forced), `po`, `embroidery-vendor`, `sublimation-vendor`, `qc-report`, `placement-sheet` |

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

- POs (`pos`, `bundles`)
- Gate passes (`gatepasses`, `returns`, `fabricin`)
- Store (`store_items`, `store_transactions`, `store_notifications`,
  `trim_templates`)
- Activity log (`activity`)
- Counters (`counters`)
- Users (`USER_DEFS` array — owners/managers/workers)

## Notes / Wiki module (Phase 1 of Notion + Milanote, Sept 2026)

Afnan asked for "a full-scale Notion + Milanote combination" inside Groovy
Ops — a company wiki/SOPs, personal notes for anyone, design/reference mood
boards, and project/task planning boards. Agreed approach: ship it in
phases rather than all at once, and build the freeform canvas (Phase 2) in
vanilla JS/SVG rather than take a dependency, consistent with this repo's
zero-new-deps policy.

**Phase 1 (shipped): `js/notes.js` — Notion-lite block pages.** Covers the
wiki/SOPs and personal-notes use cases. Every signed-in user can create a
page, either:
- **`shared`** — a team wiki page, readable by any signed-in user.
- **`personal`** — visible only to its owner (by Firebase `uid`), not even
  to owners. Deliberately no owner override on *read* here — "personal"
  means private. Owners keep *delete* power (matches the fabricin/loans
  pattern elsewhere in `firestore.rules`), in case something inappropriate
  needs removing.

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

**Nav:** "📝 Notes" is a `mainItems` entry for everyone in `buildNav()` (not
role-gated) and is in the mobile "More" sheet for owner/manager
(`openMoreSheet`) and store (`openStoreSubSheet`/`openStoreMoreSheet`).
Workers/viewers have a fixed 3-button mobile nav with **no** More button
(see `_renderMobNav` in `js/shared.js`) — rather than restructure that
deliberately-minimal layout, their path to Notes is a "📝 Notes" button on
their own "Me" page (`renderMePage()`, `js/hrm.js`). New icon: `notebook`
in `_icon()`.

**Not built yet (Phase 2, future):** the Milanote half — a freeform
drag-and-drop canvas (cards, images, connector lines, pan/zoom) for mood
boards and project/planning boards. Agreed to build it in vanilla JS/SVG
(pointer events for drag, an SVG overlay for connector lines) rather than
add a canvas library dependency. Not started — do not assume it exists.

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
  - `shopify-catalog-sync.js` — **manual / on-demand HTTP function, NOT
    scheduled.** No auth header (handler ignores the event); a plain GET
    runs it. Trigger:
    `https://groovyoperations.netlify.app/.netlify/functions/shopify-catalog-sync`.
    Fetches all products (`status=active,draft,archived`) and writes **one
    doc per variant** to `shopify_products/{variant.id}` via
    `batch.set(...)` **without `{merge:true}`** → a re-sync **fully
    overwrites** every doc (incl. `product_type`), so a plain re-run is the
    backfill — no separate upsert path needed. Flags products whose options
    aren't `Color`/`Size` (`needs_review:true`); informational only. Writes
    a run summary to `shopify_sync_meta/catalog_sync`.
  - `shopify-inventory-snapshot.js` — scheduled daily (`0 1 * * *`).
  - `shopify-order-sync.js` — scheduled every 4h (`0 */4 * * *`).
  - `shopify-weekly-close.js` — scheduled Sat (`0 2 * * 6`).
  - `shopify-order-backfill.js` — resumable historical order backfill
    (BulkWriter, time-budgeted to dodge 502s); `shopify-inventory.js` —
    connection test. (Schedules live in `netlify.toml`.)
- **Collections:** `shopify_products` (per-variant catalog), `shopify_orders`,
  `shopify_line_items` (keep historical `product_type` by design),
  `shopify_inventory_snapshots`, `shopify_weekly_closes`, `shopify_sync_meta`.
  All are `read: if signedIn(); write: if false;` in `firestore.rules` —
  only the Admin SDK (Functions) writes; clients read-only.

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
alongside `_hrmPopulateDashboard` / `_fulfillDashboardInject`. Adding a
fourth dashboard widget later means adding a fourth `typeof` guard in
`renderDashboard()` and a fourth `setTimeout` in that same dispatch line —
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
  Functions read `SHOPIFY_CLIENT_SECRET`, `POSTEX_API_TOKEN` and
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

Verified: the live Console rules were pasted by the user and diffed
byte-for-byte (identical MD5) against the repo's `firestore.rules`. They
match. The prior note here saying they'd never been republished was stale —
whoever last touched the Console already published this exact version.
**Keep updating both in lockstep**, per the comment at the top of
`firestore.rules` itself.

**Known gap, not yet closed:** `payslips` reads are `if signedIn()` — any
logged-in user, not just the employee it belongs to, can read any payslip.
The rules file's own comment flags this: tightening to per-employee
self-read needs the auth email denormalised onto each payslip doc first
(no `employeeId` → `session.email` link exists yet to check against).
Employee-record writes and payroll processing are already owner/manager
gated; this is the one remaining read-scope hole.

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

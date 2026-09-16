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

**Blocked: `www.gstatic.com`, `cdnjs.cloudflare.com`, `cdn.jsdelivr.net`,
`unpkg.com`, and `cloudinary.com` ENTIRELY** — not just
`res.cloudinary.com`; `cloudinary.com/documentation` and
`support.cloudinary.com` answer `403` to `CONNECT` as well (verified Sept
2026 via `curl` and a headless Chromium launch). So nothing about a
Cloudinary account, its settings or its docs can be checked from a session —
that always needs the human. **Reachable: `api.github.com`,
`firestore.googleapis.com`, `registry.npmjs.org`, `raw.githubusercontent.com`.**

**What changed in Sept 2026:** jsPDF/SheetJS/JsBarcode are no longer loaded
from a CDN — they are vendored under `/assets/vendor` (see "Vendored
libraries" below), fetched from `registry.npmjs.org`, which IS reachable.
So **`node tests/smoke-browser.js` now loads the whole app in real headless
Chromium** (`/opt/pw-browsers/*/chrome-linux/chrome`) and verifies every
classic script executes, every expected global exists, and all three
libraries actually work. That was impossible before.

**Still not possible: signing in or rendering a page.** The Firebase modular
SDK loads from `gstatic.com`, which is still blocked, so `__bootApp()` never
runs and the app stops at the login screen's static HTML. **A "verify in a
browser" step for any UI change is therefore still NOT possible from this
sandbox** — say so explicitly rather than skip the caveat. Real UI
verification needs the human, a phone, or Claude in Chrome.

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
/js/profile.js       Profile — one page per signed-in person (photo, chosen
                     display name, job title, department, about) plus a team
                     directory. Firestore `user_profiles/{uid}`. Reached from
                     the topbar avatar, not the nav. NOTHING SENSITIVE lives
                     here — see "Profiles" below. Loaded after boards.js.
/js/diagnostics.js   never-a-blank-screen safety net: records every uncaught
                     error, watches for a stalled render, and shows an
                     on-screen panel with a cache-reset button. Loaded FIRST,
                     before shared.js. See "Diagnostics" below.
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
```

Load order is fixed in `index.html`:
`shared → print-engine → auth → pos → embellishments → hrm → store →
gatepass → notes → boards → profile → activity → marketing`, then the
bootstrap module. All
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
- PDF: jsPDF · Excel: SheetJS · Barcodes: JsBarcode — all **vendored** in
  `/assets/vendor`, not CDN-loaded (see below)
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

**It happened again in Sept 2026, and the second time is worth recording
because of HOW it hid.** Afnan's table-QA fix and Ammar's cutting-registry
work both bumped to **`v61`**. The merge produced **no conflict at all** —
both sides had written the *identical* line, so git had nothing to resolve —
while the two `v61` builds were entirely different bytes. A clean merge is
therefore NOT evidence that the version is safe. **Read `CACHE_VERSION` on
both sides before merging, not just the conflict list**, and bump past both
(v61 + v61 → v62).

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

## Vendored libraries (Sept 2026)

jsPDF, SheetJS and JsBarcode live in **`/assets/vendor`** and are served from
this origin. They used to load from `cdnjs.cloudflare.com` and
`cdn.jsdelivr.net`, which cost three things:

1. **The PWA was not actually offline-capable.** `sw.js` routes cross-origin
   scripts network-first, so with no signal a gate-pass PDF or a payroll
   Excel export simply failed. They are in `PRECACHE_URLS` now.
2. **A third-party origin could change or vanish** under a business that
   prints gate passes and payroll from these files.
3. **Neither CDN is reachable from this sandbox**, so no session could boot
   the app in a browser to check anything. `tests/smoke-browser.js` can now.

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
  `/assets/fonts/FONT_INSTALL.md`. Known jsPDF limit: Urdu is drawn unshaped
  even with the JNN TTF embedded; also the ~10 MB JNN Regular is base64'd
  into every Urdu PDF, so those PDFs are large.
- **Public API (only global):**
  `window.printDocument({ type, data, filename })` where `type` ∈
  `po | embroidery-vendor | sublimation-vendor | gate-pass |
  placement-sheet | qc-report | payslip | daily-performance |
  stock-transfer | mood-board | generic`. **Implemented variants**
  (verified from the `_VARIANTS` registry in `printDocument`,
  `js/print-engine.js` — this list was stale here before, said only
  `gate-pass` shipped): ✅ `po` (`_renderPO`), ✅ `gate-pass`
  (`_renderGatePass`, single-page bilingual transit document), ✅
  `payslip` (`_renderPayslip`), ✅ `daily-performance`
  (`_renderDailyPerformance`), ✅ `stock-transfer`
  (`_renderStockTransfer`), and ✅ **`mood-board`** (Sept 2026 — the board
  as one picture fitted to the page plus a text index of every card
  carrying text; `_renderMoodBoard`). The mood-board picture is rasterised
  by the CALLER (`js/boards.js` draws the board onto a 2D canvas and
  passes a JPEG data URL) so the variant stays synchronous like every
  other one and the engine never learns how a board is drawn. Still not
  built: `embroidery-vendor`, `sublimation-vendor`, `placement-sheet`,
  `qc-report` — any of those (or an unknown type) logs a `console.warn`
  and renders the generic fallback (header + optional hero title +
  `data.bodyHtml` as text + bilingual footer). Opens the PDF in a new tab
  AND triggers download. The pre-opened tab shows a `_previewLoading`
  interim page (never a stark `about:blank`) during the font fetch/subset,
  and `_previewError` renders a readable failure page instead of a
  blank/closed tab. Remaining variant builders reuse the components below.
- **`_renderPO` — Notes (Sept 2026):** free-text field on the PO, entered in
  `renderPOCreate()` (`js/pos.js`, `#po-notes` textarea) and saved as
  `po.notes`. Rendered on the printed PO traveler right after the order-info
  grid/product photo, before the station tables — always in
  `PRINT_COLORS.red` (`#DC2626`), never the default body text color, so it
  stands out to every station handling the PO. Also shown in red on the PO
  detail page (`renderDetailPage()`) and in the legacy (`__usePrintEngine =
  false`) jsPDF fallback in `generatePOPdf()`, so all three paths agree.
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
  | `minimal` | `generic`, `payroll-sheet`, `payslip`, `daily-performance`, `stock-transfer`, `mood-board` |
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

**Nav:** "Creative Hub" (plain text, no icon/emoji — deliberate, per
Afnan) is a `mainItems` entry in `buildNav()` pointing at page id
`creative-hub`, in the mobile "More" sheet for owner/manager
(`openMoreSheet`) and store (`openStoreSubSheet`/`openStoreMoreSheet`), and
(for workers/viewers, whose fixed 3-button mobile nav has no More button —
see `_renderMobNav`) a button on their own "Me" page (`renderMePage()`,
`js/hrm.js`). There is no dedicated icon for this module — the `notebook`
SVG that was briefly added to `_icon()` was removed again once the nav
entry became icon-less; don't re-add it without a reason.

**Staged rollout (Sept 2026): nav-gated to Afnan only for now.** All four
of the pushes above are behind `if(session.u==='afnan')`, plus the "Me" page
button in `js/hrm.js` and the deep-link guard in `js/boards.js` — **six
checks in total**, not five; the earlier count here missed `js/hrm.js` and
was caught by `tests/invariants.test.js`, which now asserts the gate is
all-or-nothing. Note the `boards.js` one is written **inverted**
(`session.u!=='afnan'`), so a naive grep for the `===` form misses it — deliberately a
single username check, not `isOwner()` and not a role, same pattern as the
`isMustafa()`-style per-person grants already in this codebase. Afnan
asked to dogfood it alone until the module (Phase 1 + Phase 2) is further
along, then open it to the rest of the staff. This is a **nav-only** gate —
`firestore.rules` still lets any signed-in user create/read pages per the
design above, matching how this app already handles staged rollouts
elsewhere (e.g. Shopify Intel is nav-gated to `isOwner()`, not blocked at
the rules layer). To roll out: change these four `session.u==='afnan'`
checks (grep `staged rollout` in `js/shared.js`, and the one in
`js/hrm.js`) to whatever the real target audience should be — probably
just removing the condition, matching the "for everyone" design intent
above.

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
- **Link cards are manual entry** — the user types the URL, title and an
  optional description themselves (`.board-link-edit` inputs). This was a
  deliberate simplification, not an oversight: an auto-fetched preview
  (og:title/og:image) needs a server-side fetch of a user-submitted URL —
  the browser can't read another origin's HTML (CORS) — which means a new
  Netlify Function and real SSRF surface (block internal/private
  addresses, timeout, size-cap the response) to design carefully. Ship
  that as a deliberate follow-up if wanted; don't casually add a
  "quick" auto-fetch later without that hardening.
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
  Snapshots cover cards + connectors only — **not** pan/zoom (undoing a
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
  swallow panning, marquee-select and clicks on the cards inside it.
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
  could not be verified from the build sandbox** (it cannot reach
  `res.cloudinary.com` at all) — if exports come back with grey boxes
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
  places them. **Paste goes to the tray only while the tray is OPEN** —
  canvas paste has worked since Stage 1 and people rely on it, and an open
  tray is a visible statement that you are collecting rather than placing,
  so nothing is hidden. "Move to Unsorted" on the card menu is the reverse
  of dragging one out; frames and sub-board links are excluded (a frame has
  no content of its own, a board link belongs with its parent). Labels are
  hydrated with `textContent` like every other user string in this file.

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
  instead of putting a caret in the cell. The fix is the guard the delete ✕,
  the card-name span and the comment badge already carry:
  `onpointerdown="event.stopPropagation()"` on every data cell. **Anything
  clickable inside a drag surface needs it — this is the third time.** The
  cost is that a table no longer drags by its cells; it drags by its header
  strip and by the A/B/C band and row gutter, which are chrome and keep the
  drag deliberately.
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
- **Nobody has looked at the panel in a browser.** The sandbox still cannot
  sign in (gstatic blocked), so the visual is unverified as usual.

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
  empty someone's Home. Then *auto-place* whatever is left.
- **Placement is SAVED, not derived.** One-time per board; after that Home
  is an ordinary board and a card you move stays moved.
- **Auto-place is deliberately NOT undoable** — the one exception to "every
  mutating action calls `_boardsPushUndo()` first". It runs at open, right
  after the history resets, and undoing it would clear cards that reappear
  next visit: a Ctrl+Z that looks broken.
- **Sitting on a Home is not "nested".** `_boardsNestedIds` only ever
  follows a real `parentId`, so a board on your Home still lists at root in
  All boards and still reaches everyone else's Home. Same reason, creating
  a board from Home makes a **root** board with a card on Home, not a
  sub-board — nesting it under a board only you can read would drop it out
  of the list for you and nobody else.
- **Deleting a board card on Home asks to trash the BOARD**, as Milanote
  does: removing just the card is pointless, auto-place would put it back.
  Owner-only, matching `firestore.rules`. Everywhere else, deleting a board
  card still just unlinks a sub-board. Home itself can't be deleted,
  renamed, shared, templated or made Team, and its top bar drops all of it.
- Back from Home leaves the module (Creative Hub); back from a root board
  goes to Home, or to All boards if that is where you came from
  (`_boardsCameFromAll`).

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
in one observation. The sandbox cannot reach `cloudinary.com` at all — the
egress proxy answers `403` to `CONNECT` for the docs and support sites too,
not just `res.cloudinary.com` — so this was reasoned from screenshots and
then confirmed by the human, which is the only route available for anything
Cloudinary-side.

On a 401/403 for a PDF the preview still names that setting, so if the
account is ever changed or a second environment is set up, the app says what
to check instead of showing a browser error page.

Double-clicking an image or file card previews it; a plain click on a file
card no longer navigates (ctrl/cmd-click still opens a tab). The right-click
menu's Download and Open route through the same two functions as the card's
own buttons, so the two cannot drift apart.

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
Shipped: zoom floor **10% → 5%** (Milanote's own); **Fit and 100% are one
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
  **unverified from the sandbox**, which cannot reach res.cloudinary.com.
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
- Rename uses `prompt()` — `confirm()` is already the app's idiom here, and
  an inline editor on a card that is also a click-to-open target would
  fight itself.

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

**If store data goes missing again, read the error card first — it now names
the collection AND the reason.** And before adding any collection to
`_STORE_LOADS`, check which pages actually read it; the default should be
lazy, not eager.

Also fixed in passing: the log's pager border was a hardcoded `#f5f5f5` (a
bright line straight across the card in dark mode) and `setILDir` wrote a
literal `#fff` background under a themed foreground — both leftovers the
property-qualified dark-mode sweep didn't reach.

## The Sales Team ▸ Marketing (Sept 2026)

Replaces the **Content Tracker 2026** Google Sheet (Master List + monthly
dispatch tabs). Source spec: `GRVY-Marketing-Module-Spec.md` (Ammar's
Downloads, not in the repo). Built **one milestone at a time**, same as the
Mood Boards table round: M1 Creator Database + scoring · M2 Dispatch Log ·
M3 Paid PR approvals · M4 discount codes · M5 reminders + dashboard card ·
M6 reports · M7 migration. **Only M1 is built.**

- **Nav:** "The Sales Team ▸" is a collapsible parent of SUB-AREAS
  (`_salesTeamGroups()` / `_salesTeamNavHTML()` in `js/shared.js`); each
  sub-area supplies its own page list (`mktNavItems()` in
  `js/marketing.js`). **Add a Marketing page there, not in shared.js.**
  Owners see it above Embellishments; on phones it is "The Sales Team ›"
  in the More sheet.
- **The lead account** is `daniyal` → `daniyaltufail59@gmail.com`, role
  `creator_content_ops_lead`, landing on `mkt-creators`. `showPage` scopes
  that role to `mkt-*` pages, `shopify-intel` and `_CHROME_PAGES` — same
  pattern as the fulfilment redirect. **Inventory Intel is granted only
  because that page never writes**; if it gains a write action, re-scope
  (logged as a follow-up in the Inventory Intelligence change request).
- **It is the only account whose login is a real inbox**, not
  `@groovy.op`. Two server functions refuse non-`@groovy.op` targets on
  purpose — `admin-reset-password.js` (owner reset) and
  `admin-seed-profiles.js` (Sync accounts) — so neither works for Daniyal
  until they are widened deliberately. His password is set/reset through
  the Firebase Console (the reset EMAIL works for him, unlike everyone
  else) or by him via "Change password".
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
- **Known for M2:** the product picker reads `shopify_products`, which the
  daily 9am-PKT catalog sync fills — "current as of this morning".
- **Known for M7:** the sheet's Master List has **265** non-empty rows, not
  the spec's 254 — reconcile before import. The Sep 2026 tab's three rows
  (st4rr.doll and shoaibkhn.t — Lowkey Heat; shadysaidthat — Live In
  Pants) migrate into `dispatches` with date and status left blank.

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
  text). **Nobody has LOOKED at the app in dark mode** — the sandbox still
  cannot sign in (gstatic is blocked), so page-by-page visual confirmation
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
    (9am PKT)** in `netlify.toml` — this line used to say "NOT scheduled",
    which was wrong (verified against `netlify.toml`, Sept 2026). It is ALSO
    a plain HTTP function: no auth header (handler ignores the event), so a
    GET runs it on demand. **`shopify_products` is therefore only as fresh
    as 9am PKT today** unless someone triggers it — anything that reads the
    catalog (the Marketing product picker, M2) is "current as of this
    morning", not live. Trigger:
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
  (`isMarketing()` / `isContentOpsLead()`, by email). See "The Sales Team ▸
  Marketing".
- **Inventory Intel nav item** (`js/shared.js`, `buildNav()` +
  `openMoreSheet()`) → owners, **+ mustafa by username** (Sept 2026 grant,
  he's Ecom Manager). Nav-only, same shape as the Notes staged-rollout gate —
  no `firestore.rules` mirror needed since `shopify_*` collections are
  already `read: if signedIn()` for every role.

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

**Afnan's standing preference: when asked for "the rules," paste the
complete, current `firestore.rules` file, not a diff/snippet.** He copies
the whole thing into the Firebase Console in one paste. Read the live file
fresh each time rather than reconstructing it from memory or from an older
turn in the conversation.

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

**REPUBLISH OUTSTANDING (16 Sept 2026) — two changes, send them together:**
`71b4acb` (Mood Boards Trash: `mood_boards/{id}/trash`) and the Marketing M1
branch (`creators`, `creator_handles`, `scoring_config`,
`isContentOpsLead()`). Neither is live until Afnan pastes the current file
into the Console. **Marketing M1 is not "done" until this is confirmed** —
the Creator Database shows its rules error card until then.

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
  libraries are vendored.** It still cannot sign in — gstatic is blocked, so
  `__bootApp()` never runs. Skips cleanly with no browser. Note it runs the
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

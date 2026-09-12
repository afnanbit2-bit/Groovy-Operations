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
/js/notes.js         Creative Hub / Notes — Phase 1 of the Notion+Milanote
                     module (see "Creative Hub / Notes module" below). Hub
                     landing page (shared infra, also renders Mood Boards'
                     tile) + block-based pages, TEAM or PRIVATE.
                     Shared/cross-track, like pos.js/gatepass.js.
/js/boards.js        Mood Boards — Phase 2 of the Notion+Milanote module,
                     reached through the Creative Hub grid in js/notes.js.
                     Freeform canvas: image/text/link/file/to-do/frame/
                     sub-board cards, connector lines, pan/zoom, find +
                     minimap, nesting + templates, TEAM or PRIVATE. Loaded
                     after notes.js. Shared/cross-track.
```

Load order is fixed in `index.html`:
`shared → print-engine → auth → pos → embellishments → hrm → store →
gatepass → notes → boards → activity`, then the bootstrap module. All
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
  placement-sheet | qc-report | mood-board | generic`. **Implemented
  variants:** `generic` (fallback), ✅ **`gate-pass`** (single-page
  bilingual transit document — `_renderGatePass`, dispatched via the
  `_VARIANTS` registry in `printDocument`), `payslip`,
  `daily-performance`, `stock-transfer`, `po`, and ✅ **`mood-board`**
  (Sept 2026 — the board as one picture fitted to the page plus a text
  index of every card carrying text; `_renderMoodBoard`). The mood-board
  picture is rasterised by the CALLER (`js/boards.js` draws the board onto
  a 2D canvas and passes a JPEG data URL) so the variant stays synchronous
  like every other one and the engine never learns how a board is drawn. Any not-yet-built type logs a
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
of the pushes above are behind `if(session.u==='afnan')` (a fifth check
guards Mood Boards' deep links — see Stage 5 below) — deliberately a
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
  full-viewport takeover (`z-index:40`) rather than living inside the
  normal `#sidebar`/`#main-content` shell — deliberate, a freeform
  pan/zoom canvas needs the room a squeezed content column can't give it.
  This is the first page in the app to do this; the "← Boards" back button
  is the only way out, so don't add a second full-takeover page without
  checking it doesn't strand someone.
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

- **Marquee is Shift+drag on empty canvas; plain drag still pans.**
  Deliberately the opposite way round from Milanote (where drag marquees
  and space pans): dragging has *been* how you pan here since Stage 1, and
  the stage has no scrollbars, so making plain drag select would strand
  anyone who never found the modifier. A plain click on empty canvas that
  doesn't turn into a pan clears the selection.
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
  `boardsFrameSelection` to wrap a selection in a labelled frame). A real
  column container needs stored membership and must reposition its
  children, which fights the deliberately membership-free frame model
  above. The actions deliver the same value — tidy alignment without
  hand-placing cards — with no new data model, and compose with frames
  (stack, then frame the result). **This was a substitution, flagged to
  Afnan at the time**; if a true container is ever wanted it's a separate
  build, not a tweak.
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
  still Afnan-only. That makes **five** `session.u==='afnan'` checks to
  remove at rollout (four in `js/shared.js`/`js/hrm.js` per the Creative
  Hub section above, plus `_boardsConsumeDeepLink` in `js/boards.js`).

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

**Afnan's standing preference: when asked for "the rules," paste the
complete, current `firestore.rules` file, not a diff/snippet.** He copies
the whole thing into the Firebase Console in one paste. Read the live file
fresh each time rather than reconstructing it from memory or from an older
turn in the conversation.

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

# Groovy Operations — Claude session notes

Single-file SPA at `index.html`, deployed to Netlify on every push to `main`.
Two contributors: Afnan (HRM/operations side, with Claude) and Ammar Shah
(printing/embellishments side, also with Claude on a separate session).

## Stack

- Frontend: vanilla JS module in `index.html`
- Auth: Firebase Auth (project `groovy-gatepass`)
- DB: Cloud Firestore + Realtime Database (RTDB used only for attendance)
- Images: Cloudinary, unsigned preset `groovy-ops`
- PDF: jsPDF · Excel: SheetJS (both via CDN)
- Hosting: Netlify (auto-deploy on push to `main`)

## Domain map — who owns what

### Afnan / HRM track (Claude)

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

### Ammar Shah / Embellishments track (Claude)

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

## Shared touchpoints — coordinate before changing

These functions/blocks are edited by both tracks. Check the other branch
before pushing changes here:

- `buildNav()` — both tracks add nav items here
- `renderPage(id)` switch — both tracks add page dispatch cases here
- `loadPrintingData()` / `loadHRMData()` / `loadHRMSession4Data()` /
  `loadPayrollData()` / `loadBugReports()` — be careful with order
- `<head>` CSS, especially `@media (max-width: 600px)` block
- `_icon(name, size)` SVG set — add new icons rather than reusing
- `openMobSheet({title, items})` and the More-sheet items list
- `:root` CSS variables — accents (`--accent-urgent`, `--accent-warning`,
  `--accent-success`) and radii (`--radius-card`, `--radius-bubble`)

## Permission helpers

Username-gated (not just role-gated). Defined near the top of the
HRM section in `index.html`:

- `_canViewPayroll()` → afnan, ammar, mustafa
- `_canProcessPayroll()` → afnan, ammar
- `_canViewHRMOps()` → afnan, ammar, mustafa (advances/loans/policy)
- `_canApproveHRMOps()` → afnan, ammar
- `_canEditPolicy()` → afnan, ammar

Plain role checks elsewhere:
- `session.role === 'owner' | 'manager' | 'store' | 'worker' | 'viewer'`
- Helpers: `isObserver()`, `isPrintWorker()`, `isStitchWorker()`,
  `isQCWorker()`, `isBundleWorker()`, `canManageRecipes()`, `canSeePrinting()`

## Outstanding action — Firestore rules not yet published

The repo's `firestore.rules` is the canonical version but the live rules
in Firebase Console have NOT been republished yet. Until that's done:

- Bug submissions fail with "Missing or insufficient permissions"
- Newer collections may also fail to write (advances, loans, policy log,
  payroll runs/slips, hrm_notifications)

To fix: open
  https://console.firebase.google.com/project/groovy-gatepass/firestore/rules
replace contents with the contents of `firestore.rules` from the repo,
hit Publish, hard-refresh app on phones.

## Branch / merge workflow

- Each task is on a `claude/<task>` branch, then fast-forward into `main`
  and pushed. Sandbox cannot delete remote branches (HTTP 403), so feature
  branches accumulate on GitHub. Clean up at:
  https://github.com/afnanbit2-bit/Groovy-Operations/branches
- Ammar's track uses GitHub PRs (#9 through #16, #23 so far) merged to main.
- Both tracks push to the same `main`; Netlify deploys main automatically.

## Running locally

No build step. `python -m http.server` from the repo root, open
`http://localhost:8000/`. The Firebase config in `index.html` points at
the live `groovy-gatepass` project, so any local writes hit the same
Firestore as production. Read-only smoke tests are safe; destructive
flows (process payroll, mark paid, approve advances, mark bug fixed)
are NOT — they mutate live data.

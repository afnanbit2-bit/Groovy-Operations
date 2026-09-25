# The Board

One shared calendar and one set of task lists, over **one object: an item**.
An item with a date is on the calendar. An item in a list is a to-do. An item
can be both. There is deliberately no second model.

UI label: `the board` — from `TB_NAME` in [js/theboard.js](js/theboard.js),
the only place that string is written.

---

## Why everything is prefixed `tb`

`js/boards.js` (Mood Boards, ~10,400 lines) already owns the word "board" in
this codebase: page ids `boards` / `boards-all` / `board-canvas`, **259
`.board-*` CSS classes** and ~400 `boards*` / `_boards*` globals. These are
classic scripts sharing **one lexical scope**, so a top-level `const` or a
`.board-item` class declared here would not merely be confusing — a duplicate
top-level `const` across two classic scripts is a parse error that takes the
whole app down, and `tests/smoke-browser.js` is what catches it.

So: **`tb` for every JS name, `.tb-` for every CSS class, `tb-` for every page
id.** Firestore names do not share JS scope, so the collections keep the
spec's `board_` prefix and read naturally.

The two modules are different levels and are not being merged: Mood Boards
lives inside Creative Hub; The Board is a top-level tab.

---

## Data model

All collections top-level, prefixed `board_`. Day dates are `YYYY-MM-DD`
strings in Asia/Karachi, so calendar queries are string range queries with no
timezone arithmetic.

| Collection | Holds |
|---|---|
| `board_lists/{listId}` | a shared list (admin + members) or a private one |
| `board_items/{itemId}` | the item — calendar entry, to-do, or both |
| `board_items/{itemId}/comments/{id}` | the thread |
| `board_items/{itemId}/activity/{id}` | append-only log |
| `board_config/{doc}` | launch markers the calendar draws |

Full field lists are in the build spec. Phase 1 ships the rules and indexes
for all of them; phase 2 ships the writers.

**There is no `board_notifications` collection**, on purpose — see
Notifications below.

### Reads are two queries, never one

Every read rule is a **two-clause** condition (`visibility == 'shared'` **or**
`ownerUid == uid`). Firestore rules are **not a query filter**: a single broad
query whose safety depends on a field outside its `where()` is **rejected
outright** rather than silently returning less. So each clause gets its own
single-field query, merged client-side — exactly what `loadNotesData()` and
`loadBoardsData()` already do. Do not "simplify" this into one query.

---

## Access

| | |
|---|---|
| **Board users** | ammar, afnan, daniyal, mustafa, saim |
| **Board owners** | ammar, afnan — override any lock, manage access, run the seed |

`BOARD_USERS` / `BOARD_OWNERS` live in [js/auth.js](js/auth.js) and are
mirrored **by email** as `isBoardUser()` / `isBoardOwner()` in
[firestore.rules](firestore.rules). `tests/theboard.test.js` fails if the two
lists ever name different people — the same guard `isPaidPRApprover()` and
`isScoringAdmin()` carry, and the only thing that stops a nav grant and a
rules grant from drifting apart.

**Board owner is not the app's `owner` role.** It is who may override a lock.
Same two people today; a separate list so that stays a decision rather than a
coincidence.

**To add someone:** add the username to `BOARD_USERS` **and** the email to
`isBoardUser()` in the rules, then republish the rules. One without the other
fails the test.

### Roles and where they land

| Role | Sidebar | Lands on |
|---|---|---|
| `owner` / `manager` | the board **first**, above Dashboard | their usual page |
| `creator_content_ops_lead` (Daniyal) | the board first, then his Marketing pages | `mkt-creators` |
| `designer` (Saim) | the board only | `tb-dash` |

`designer` is new. Saim is a graphic designer who needs the board and nothing
else: `manager` would have handed him POs, gate passes, HRM and the store, and
`viewer` gives a fixed 3-button phone nav with no More sheet plus a My Work
page that means nothing to him.

**Saim is deliberately NOT given Creative Hub.** If that is wanted, it is one
name in `_CREATIVE_HUB_USERS` ([js/shared.js](js/shared.js)) plus its
assertion in `tests/invariants.test.js`, and a second item in his nav branch.

⚠️ **`saim` and `sami` are two different people**, one letter apart. Sami is
the CSR Team Lead and is **not** a Board user, so the two never appear in one
mention list. A test holds that.

---

## Adding the user (Saim)

There is no in-app account creation — it was removed because it shipped
passwords to the browser — and `USER_DEFS` is a served static file, so a new
account is a **code change** either way. No Cloud Function avoids that.

1. **Firebase Console → Authentication → Add user.** Email **must** be
   `saim@groovy.op`; `admin-seed-profiles.js` accepts only that domain and
   login matches on it exactly.
2. The `USER_DEFS` entry is already in [js/auth.js](js/auth.js) (shipped in
   phase 1).
3. **Profile page → Team card → "Sync accounts"** (owners + Mustafa). This
   resolves the email to a uid and writes `user_profiles/{uid}` with
   `{merge:true}` — it seeds, it never resets.

Step 3 matters: profiles are keyed by Firebase uid, and until that row exists
nobody can edit his profile and `boardColor` has nowhere to live.

---

## Deploying the rules

```bash
firebase deploy --only firestore
```

`firebase.json` is scoped to **rules and indexes only** — no `hosting` key, so
a deploy cannot touch the Netlify site, and no `database` key, so
`database.rules.json` (RTDB) still has to be pasted into the Console by hand
if it ever changes.

**Phase 1 changed `firestore.rules`, so it needs deploying before anyone can
use the board.** Note there were already two undeployed Marketing commits
outstanding before this work — that deploy carries them too, which is
expected and correct.

---

## Notifications

**The Board has no collection of its own.** It writes into
`hrm_notifications`, the bell every other module already uses (addressed by
`forUser`, deterministic ids) — `js/marketing.js` does the same without
touching `js/hrm.js`. That buys the top bar and the unread badge for nothing,
with one store instead of two. The Dashboard's inbox card reads the same
collection filtered on `source: 'tb'`.

**The price, and why `tbNotifPayload()` is the only way in:**
`_hrmNotifCardHTML` (js/hrm.js) prints `title` and `message` into HTML
**raw**. Every Board notification is escaped in that helper before it is
written. Nothing may bypass it, and a test asserts a tag in a title cannot
reach the bell.

Id shape: `tb_{type}_{itemId}_{fromUid}_{10-minute bucket}` — so several
devices or a double click produce one row, and a dismissed notification is
never raised again.

---

## Rules that this module holds to

Three the codebase learned the hard way, now part of the spec:

1. **Pointer events only, never HTML5 drag.** The Mood Boards stage reads a
   native `dragstart` as "files from the desktop"; a native drag also cancels
   the pointer stream a card drag runs on.
2. **Anything clickable inside a drag surface needs
   `onpointerdown="event.stopPropagation()"`.** A captured pointer retargets
   the following `click` to the capturing element. This has bitten five times
   in `js/boards.js` — the delete ✕, a file card, a table cell, a to-do item,
   a link.
3. **User text is hydrated with `textContent`, never interpolated.** For
   markdown-lite that means the `DOMParser`-into-an-inert-document allow-list
   rebuild, sanitising on **read and write** — a body written by an older
   build or by hand in the Console is cleaned before it is ever shown.

And one this module adds:

4. **Never `toISOString().slice(0,10)` for a day.** It is UTC, and in PKT
   (UTC+5) it names the *previous* day between midnight and 5am. Use `_tbDay`.

---

## Known gaps and follow-ups

- **Three live UTC day-string bugs elsewhere in the app**, left alone
  deliberately (not this module's to fix):
  `js/embellishments.js:4028` (the main dashboard's "Today" PO count — reads
  0 before 5am), `js/embellishments.js:3002` and `js/embellishments.js:3075`
  (date inputs defaulting to yesterday before 5am).
- **Firebase billing plan was not verified.** The sandbox cannot reach the
  console. It does not gate anything here: the 08:00 PKT reminder is a
  scheduled **Netlify** function with the service account, not a Cloud
  Function, so there is no Blaze dependency in this build.
- **Nothing here has been seen in a browser signed in.** The sandbox cannot
  sign in (gstatic is blocked), so the visual is unverified as usual. Logic,
  the real-Chromium script load and the rendered geometry of the shell are
  tested.
- Phase 1 screens are honest placeholders, not loading states.
- **Comments, @mentions and file attachments are phase 4.** The drawer
  has no thread yet; handover still posts its note as a comment document,
  which the thread will pick up when it lands.
- The inbox screen is phase 4 — board notifications already reach the bell.
- **The calendar's month grid hides a marker's LABEL at phone width.** A
  ~50px day square crushed it to 1px (measured). The left bar stays, so
  the day is still visibly marked, and the week view carries the word.
- **`tests/store-accounts.test.js:1196` fails on Windows only.** Its regex
  matches a bare `
` while git checks `js/shared.js` out with CRLF here;
  CI (Linux, LF) passes. One character fixes it (`
` → `?
`). Not
  this module's file, so it is left alone.

---

## Phase status

| Phase | State |
|---|---|
| 0 — inventory + plan | done |
| 1 — foundations | **done** — audience, gating, nav, rules, indexes, routing, empty screens |
| 2 — items, lists, dashboard, drawer | **done** — item CRUD, quick-add grammar, cards 1–8, the drawer, the seed |
| 3 — calendar | **done** — month + week, filters, pointer drag with lock enforcement |
| 3 — calendar | |
| 4 — comments, mentions, files, inbox | |
| 4b — scheduled reminder (Netlify) | |
| 5 — responsive, polish, acceptance | |

Cuts agreed for the Sep 28 date: Dashboard ships cards 1–8 in phase 2 (9–12
move to phase 5); the calendar ships month + week, filters and pointer drag
with lock enforcement in phase 3 (rows-by-person and the unscheduled tray move
to phase 5).

## Running the seed

```bash
node scripts/seed-board.js            # dry run — prints what it would do
node scripts/seed-board.js --write    # actually writes
```

Run it **locally, as an owner**. It uses the Admin SDK, which bypasses
security rules by design and must never be reachable from a browser. It
needs `FIREBASE_SERVICE_ACCOUNT` (the JSON) or `GOOGLE_APPLICATION_CREDENTIALS`
(a path to the key file), and it needs every one of the five Auth accounts to
exist — including Saim's, or it stops and says so rather than seeding a
half-populated board.

It writes `board_config/markers`, the **Winter Drop 2027** list and 42
milestones.

**Re-running is safe, by deterministic id rather than by "does a row with
this title exist".** The id is `tb_<lane>_<title-slug>`, so a re-run
addresses the same documents and merges. It also **never undoes real work**:
`date`, `status`, `steps`, `notes`, `myDay`, `assigneeUids`, `locked` and
`dateHistory` are written once, on create, and left alone after that — so
re-seeding after someone has moved a date does not move it back.

Two milestones are seeded with **no date** on purpose (denim and knit bulk
landing). They appear in Ammar's and Afnan's "needs a date" card on day one.

## Phase 2 — what shipped, and the decisions inside it

- **Every decision is a pure function; the writers are thin.**
  `tbParseQuickAdd`, `tbNewItem`, `tbItemPatch`, `tbVisibilityFor`,
  `tbHandoverPlan`, `tbDonePlan`, `tbItemColorKey` and the eight Dashboard
  selectors take arguments and return values. A rule about what an item
  becomes is therefore assertable without a database, and exists once.
- **An item and its activity row land in ONE batch.** A log written
  separately is one that goes missing when the item write fails.
- **Quick add**: `@handle`, `#lane`, `!`/`!!`, and dates (`today`,
  `tomorrow`, `mon…sun`, `oct 5`, `5 oct`, `5/10`). First date match wins.
  Two deliberate calls: **`5/10` is D/M**, the fifth of October, because
  this is a Pakistani team; and **`!` only counts as a standalone token**,
  so "fix this!" is not silently a priority. An **unknown handle stays in
  the title** — `@baber` is a real person, just not on the board — and the
  preview line says so.
- **Row titles wrap to two lines rather than truncating.** A deliberate
  reading of §10's "44px rows": the row keeps 44px as a *minimum*. Measured
  — the real seed titles are long enough that one truncated line is a task
  you cannot read.
- **Dashboard cards 1–8 do not double-count.** "My day" excludes what is
  already overdue or due today; "assigned to me" excludes all three above
  it. Card 8 (deadlines) is deliberately **not** filtered by assignee — it
  is the drop's critical path, whoever owns each gate.
- **Completing the last step does not complete the item** (§8.3). The
  drawer shows a hint and waits for a human to review.
- **A refused write says so and re-reads** rather than leaving a row
  looking done. A permission error names the rules deploy as the likely
  cause, because that is what it usually is.

## Phase 3 — the calendar

Month and week over the same items the Dashboard reads, with the drag the
whole lock model exists for. **Rows-by-person and the unscheduled tray are
phase 5**, as agreed.

- **The week starts MONDAY.** Pakistan's weekend is Saturday and Sunday, so
  a Sunday-first grid splits the working week across two rows.
- **A month gets the rows it needs** — five for October 2026, six for August,
  four for February 2027 — rather than a fixed six with a blank trailing
  week. A day from a neighbouring month is dimmed but **still a drop target**,
  or the 1st of next month would be unreachable from the month you are on.
- **"Me" is what you are ON, not what you own.** The calendar answers "what
  is my week", and something you set for someone else is not your week.
  "Everyone" adds the shared items and **still never shows someone else's
  private one** — the rules would refuse it, and the UI has to agree.
- **One filter predicate** serves the month, the week and the count, so a
  chip can never say 4 while the grid draws 3. View and filters are per
  VIEWER in `localStorage`, never on the board.
- **`tbMovePlan` is the whole lock model in one pure function**: refused with
  a reason naming the locker, or a patch plus the history entry plus the
  people to tell. A board owner's override is recorded **in the activity
  payload**, not only in a toast. Everyone else on the item is notified; the
  mover is not told about their own move.
- **The drag is pointer-only and captures LAZILY, past a 4px threshold.** An
  eager `setPointerCapture` retargets the following `click` to the capturing
  element — the bug `js/boards.js` found five times under five names.
  Verified by removing the threshold: the click stops opening the drawer.
- **The keyboard reaches the same decision** — `[` / `]` a day, Shift+arrows
  a week — and cannot walk around a lock either.
- **A locked pill offers no drag affordance at all** to someone who cannot
  move it: the refusal is visible before the pointer goes down.
- **The move is optimistic and snaps back.** The pill moves at once; a
  refused write re-reads, repaints and restores the old date rather than
  leaving a lie on screen.
- **On a phone the calendar opens on the WEEK** (spec §11). A month grid at
  420px is seven ~50px columns, which fits a day number and nothing else.
  Only a default — a saved preference outranks it.

## Acceptance script

The 15-step script in the build spec, run manually as two users in two
browsers. Not yet run — it needs phases 2–4. Results get recorded here.

## Tests

```bash
node tests/run.js theboard      # this module
node tests/run.js               # everything
node tests/smoke-browser.js     # every script loads in real Chromium
node tests/smoke-layout.js      # the shell's geometry and contrast
```

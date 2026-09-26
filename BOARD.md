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

**Reading is shared with the bell.** The inbox marks a row read by pushing
the username into the same `readBy` array `hrmDismissNotif` writes, so
dismissing in the bell clears it from the Board and vice versa. One unread
count, three surfaces, and no way for them to disagree.

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

And two this module adds:

4. **Never `toISOString().slice(0,10)` for a day.** It is UTC, and in PKT
   (UTC+5) it names the *previous* day between midnight and 5am. Use `_tbDay`.
5. **Never give a `window.X=` handler the name of a top-level function.** In
   a browser a classic script's top-level `function X` IS `window.X`, so the
   assignment silently replaces it. That is the Sep 2026 calendar freeze:
   `window.tbCalFilter=` (the dropdown handler) replaced `function
   tbCalFilter` (the pure filter), the calendar called the handler, the
   handler repainted the calendar, and the tab locked for ~17s until the
   stack overflowed — leaving a 1.36 MB junk filter in localStorage each
   time. The node harness gives every script its own `window`, so no logic
   suite could see it. `tests/invariants.test.js` now forbids the shape
   repo-wide (a self-alias or a capture-and-call wrap is allowed), and
   **`tests/smoke-board.js` drives every Board page and calendar control in
   real Chromium** — run it before pushing any Board change.

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
- **Phase 4b — the 08:00 PKT reminder — is BUILT (session 2, P2).**
  `netlify/functions/board-reminder.js`, scheduled `0 3 * * *` (03:00 UTC =
  08:00 PKT), body in `scripts/board-reminder-plan.js`. Every open item due
  today gets one `due_today` row per person on it; every open item past its
  date gets one `overdue` row per person, **every day** it stays overdue.
  Rows go into `hrm_notifications` in the client's own shape (source `tb`,
  `forUser` = username, escaped for the bell), with an id of
  `tb_<type>_<item>_<uid>_<YYYYMMDD>`, so a second run the same day writes
  nothing and a read reminder never comes back unread. "Today" is
  Pakistan's day (UTC+5, no DST). A summary of each run is kept at
  `board_config/reminder`. It runs only on the **published production
  deploy** and cannot be opened by URL (a scheduled function answers 403).
  Priority is `normal`, not `high`: an overdue item repeats daily, and a
  red card per item per morning would be noise.
- **The Dashboard activity card does not show step ticks, file adds, lock
  changes or handovers.** It is derived from the items in memory, not from
  the activity subcollections — see phase 5 below for why. Those events
  are all in the item drawer's own activity section, which reads the real
  log.
- **The calendar's month grid hides a marker's LABEL at phone width.** A
  ~50px day square crushed it to 1px (measured). The left bar stays, so
  the day is still visibly marked, and the week view carries the word.
- **`tests/store-accounts.test.js:1196` fails on Windows only.** Its regex
  matches a bare `
` while git checks `js/shared.js` out with CRLF here;
  CI (Linux, LF) passes. One character fixes it (`
` → `
?
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
| 4 — comments, mentions, files, inbox | **done** — the thread, @ ranking, Cloudinary files, the live inbox |
| 5 — responsive, shortcuts, search, cards 10–12 | **done** — see below |
| 4b — scheduled reminder (Netlify) | **built** (session 2, P2) — `board-reminder`, 08:00 PKT |

Cuts agreed for the Sep 28 date: Dashboard ships cards 1–8 in phase 2 (9–12
move to phase 5); the calendar ships month + week, filters and pointer drag
with lock enforcement in phase 3 (rows-by-person and the unscheduled tray move
to phase 5).

## Running the seed

**The normal way is the Run seed button** in Board Settings (Board owners
only: the rail's Settings, at the foot). Preview first — it writes nothing
and says what it would do. The button calls
`netlify/functions/board-seed.js`, which checks the caller's verified ID
token server-side and runs the Admin SDK there.

The command line is the fallback, and it **writes by default** (session 2):

```bash
node scripts/seed-board.js --dry-run   # prints what it would write
node scripts/seed-board.js             # writes
```

It needs `FIREBASE_SERVICE_ACCOUNT` (the JSON) or
`GOOGLE_APPLICATION_CREDENTIALS` (a path to the key file). Both ways run the
same body, `scripts/board-seed-plan.js`.

It writes `board_config/markers`, the **Winter Drop 2027** list, 42
milestones, a profile row for each Board person, and its own record,
`board_config/seed`. **A missing login is skipped and named, not fatal**;
any other Auth error stops the run before it writes anything.

**Re-running is safe, and it touches nothing that exists** (review of
`9e3b521`, 26 Sept 2026). Ids are deterministic — `tb_<lane>_<title-slug>` —
so a re-run addresses the same documents, and:

- an item already on the board is **not written at all** (its title, list,
  visibility, owner, attachments, dates and steps are whoever's using it);
- a milestone **deleted since** the seed made it is **not brought back** —
  the record remembers it;
- the list's title, colour, archive state and admin are its owner's; the
  seed only **adds a person it has never added before** (someone with no
  login last time), so a person taken off the list stays off;
- the markers are written only if there are none;
- the one thing a re-run adds to an existing milestone is a person the seed
  **left off for want of a login** who has one now — by `arrayUnion`, so it
  can only add, and only them.

A board seeded before the record existed is **adopted as it stands**: nothing
on it changes, nobody is added to anything, and the record starts from what
is there. The first version merged every field but a short keep-list back
onto each item, which emptied attachments, put back renamed titles and made
privately-moved items shared again.

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

## Phase 4 — comments, mentions, files, the inbox

The Slack-thread half. No `firestore.rules` change and no new index: the
`comments` subcollection rule and the `user_profiles` self-update rule
shipped in phase 1, `hrm_notifications` is already `signedIn()`, and the
inbox is a single-field `where('forUser','==',u)` query sorted in memory.

- **The XSS boundary here is "escape first, format second", and it is a
  DIFFERENT boundary from js/boards.js's.** Mood Boards stores real HTML
  (a contenteditable's innerHTML) and has to parse it into an inert
  document and rebuild it against a tag allow-list. The Board stores PLAIN
  TEXT: once `_tbEsc` has run there is no `<`, `>`, `&` or quote the
  author typed, so **every tag in the output is one `tbRenderBody` wrote**
  and there is nothing left to sanitise. A `DOMParser` pass here would be
  theatre — and untestable, since the harness's DOMParser is a tag-soup
  stub. Markdown-lite is bold, italic, code spans, `@[handle]`, newlines
  and http(s) autolinks; **the scheme check IS the regex**, so
  `javascript:` can never match at all.
- **`@[handle]` is the stored form and an unknown handle stays literal** —
  the call `tbParseQuickAdd` already made, for the same reason: `@baber`
  is a real person, just not on the board.
- **Ammar's popover rule, which is not in the spec: ENTER SELECTS ONLY
  when exactly one candidate matches or a row has been arrowed to.**
  `tbMentionAccepts` is the whole rule, in four lines. A popover that
  swallows Enter on an ambiguous list picks somebody at random on the
  author's behalf, and the author finds out when the wrong person answers.
- **Ranking is read off the AUTHOR's own `user_profiles/{uid}`
  `.tbMentionStats`** — nobody else reads it, so it is their data, and the
  self-update rule already covers it. It is written **`set` with
  `{merge:true}`, never `update`**: a profile row that does not exist yet
  would fail an `updateDoc` and take the comment down with it, and
  carrying `uid` satisfies the create clause as well as the update one.
- **Typing does NOT repaint.** The board has one repaint and it rebuilds
  `main-content` wholesale, which would destroy the textarea the caret is
  in and take the popover's anchor with it. `tbCompInput` mutates a draft
  and repaints ONE element — the same reason Notes' block editor mutates
  in place.
- **Everyone in the conversation hears about a comment ONCE.** Someone
  mentioned has already been told; two bell rows for one comment is what
  makes a bell worth ignoring.
- **FILES ARE CLOUDINARY AND THE THUMBNAIL IS A DELIVERY TRANSFORM.** The
  spec asked for Firebase Storage plus a client-side 320px JPEG stored
  alongside; Ammar's phase-0 decision was to let the CDN do it. So there
  is no second artefact to keep in step, nothing to migrate for a file
  uploaded before this, and the original is never rewritten. 25 MB cap,
  ours, checked before sending — and Cloudinary's own refusal is passed
  through with a line saying that number lives in the account's plan.
  A PDF's page-1 render is **best effort by design** (the account setting
  js/boards.js records) and falls back to a chip.
- **Only an anchored `https://res.cloudinary.com/` URL reaches an href or
  a src** — `res.cloudinary.com.evil.test` must not pass. The rule
  `_profPhotoUrl` and `_boardsCoverUrl` already hold.
- **A locked item is not a dead end.** Request move posts the templated
  ask into the thread mentioning the locker, so the answer lands where the
  question is rather than in a WhatsApp message nobody can find.
- **The inbox is LIVE**, because the phase's definition of done is a badge
  that moves in another browser within a second. The listener starts from
  a **`startApp` wrap** — the pattern js/boards.js already uses — so the
  count is live on every page, not only while the Board is open.
  **No listener is a fallback, not a hang**: with no `onSnapshot` bridged
  it does one `getDocs` instead, and a refused read renders an error card
  rather than "nothing in your inbox".
- **The first snapshot is history, not news** — it seeds silently, or
  signing in would fire a toast for every unread row at once. A toast
  after that only while the Board is open (spec §5).
- **A live bug phase 4 exposed:** `tbHandoverPlan` interpolated the raw
  UID into its comment body, so the thread — which nothing could read
  until this phase — would have said "handed over to @u-dani". It is the
  `@[handle]` token now.

### Two test lessons, both already in this file and both caught again

- **`js/shared.js` declares `currentPage` at top level, so it CLOBBERS
  the harness's `currentPage` option** — exactly as it clobbers `session`
  (the phase-1 lesson). The "a toast only while the Board is open"
  assertion therefore passed **vacuously**: nothing toasted because the
  page was never `tb-*` at all. Found by breaking the seeding and watching
  the suite stay green. Set it with `app.run` after load.
- **The working tree is CRLF here**, so a multi-line search string written
  with a bare newline matches nothing and a break reports a clean pass —
  which reads exactly like "the assertion has no teeth". Three breaks
  looked like passes for that reason before the cause was found.
  Normalise the line endings, or break one line at a time.

Verified by reverting each: the escape order (3 fail), the Enter rule (2),
notifying yourself (3), the inbox's source filter (6), the comment leaving
the batch (1, and it reads the batch's CONTENTS — counting writes proves
nothing), `set` to `update` on the profile (1), the first-snapshot seeding
(6) and the no-listener fallback (5). Both new `smoke-layout` fragments
fail all 12 of their jobs when the mention chip's or the inbox row's ink
is broken.

**Nobody has typed a comment, mentioned anyone or uploaded a file on a
real screen** — the sandbox cannot sign in.

## Phase 5 — the phone, the keyboard, search, the last cards

The end of the build spec bar 4b. **No `firestore.rules` change, no new
index, and no cross-track file touched at all** — phase 5 is
`js/theboard.js`, `css/main.css` and the tests.

- **Spec §11's breakpoints replaced the module's own.** It shipped on
  900/600 through phases 1–4; the bands are **≥1024 desktop · 640–1023
  tablet · <640 phone** now, and `_tbIsPhone()` moved 600 → 639 with them.
  A 620px screen was being given the month grid it cannot render.
- **The rail does NOT collapse to icons in the tablet band, deliberately.**
  §11 asks for icons; this module has none, on purpose — the Creative Hub
  precedent, where the nav entry is plain text and the `notebook` glyph was
  removed again once it became icon-less. Inventing an icon set for four
  words would be a second UI vocabulary. It docks as a horizontal strip
  instead, which is what the phone already did.
- **A search is a MODE, not a fifth page.** One box, in the rail so it is
  on every screen; a query takes the screen over and clearing puts you
  back where you were. It covers titles, notes, steps and lanes over the
  loaded set — and **comments only in threads that have been opened this
  session**, which the result row and the empty state both say out loud. A
  thread is a subcollection read when a drawer opens; claiming otherwise
  would be a filter that lies.
- **A title hit outranks one buried in notes**, because somebody searching
  a word is far more often looking for the thing named after it.
- **`tbShortcutFor` is the whole keyboard in one pure function** — it
  returns an action's name and never performs it, so every branch is
  assertable without a keyboard. **Escape is read BEFORE the editable
  bail**, or it is handed to the browser and does nothing; its precedence
  is shortcut-list → drawer → search. Modified keys are the OS's. The
  listener is registered ONCE at load and bails unless a `tb-` page is on
  screen, so `d` cannot navigate away from somebody typing on another one.
  A test asserts every key the `?` overlay advertises is a key that does
  something.
- **A RENDER FUNCTION MUST NOT WRITE**, and the tests caught this one:
  `boardLastSeenAt` started life inside `_tbDashboard`, which turned every
  repaint into a round trip — the create test went from two documents to
  three. It is written from `tbRenderPage` on Dashboard OPEN now,
  throttled to once every ten minutes, `set` with `{merge:true}` carrying
  `uid` for the reason the mention stats are.
- **Card 11 (activity) is DERIVED from the items already in memory** —
  created, moved and done. Both of the spec's own examples fall straight
  out of fields the item already carries, so this needs no
  collection-group query, no new index, **no `firestore.rules` change**
  and nothing that can go stale. What it therefore does not cover is
  stated on the card's own comment and in the gaps list above.
- **A card with nothing to SAY is hidden, not rendered empty** (§7.1).
  Five team rows reading "0 open" answers no question — and it would
  suppress the empty state, which §10 says is one sentence plus one
  action. Cards 10 and 12 hide when nothing is open.
- **No row is an accusation.** Card 10's "has not opened the board today"
  dot reads `null` — unknown, and draws nothing — for somebody with no
  profile row, because never having signed in since Profiles shipped is
  not the same as not having looked.
- **ONE predicate serves the calendar grid and the unscheduled tray**
  (`_tbCalPass`, extracted here). A second copy is how a chip comes to say
  4 while the tray draws 3.
- **Rows-by-person is a way of reading the WEEK**, so it only appears on a
  week and never on a phone: seven columns times five people is not 390px.
  Each row runs the same filter the grid does with the person pinned, so
  "everyone's week" cannot disagree with the week you were just on.
- **On a phone a pill is HELD, not dragged** (§11). A 4px threshold aimed
  at a ~50px day square is not a gesture a thumb can land, and the tray
  exists precisely to be moved FROM. A 500ms hold opens a move-to sheet
  with today / tomorrow / next week and a date field; a finger that
  travels more than 8px is a scroll and cancels it. The lock is checked
  before the sheet opens, not after.

Verified by reverting each: Escape after the editable bail (1 fails), the
tray un-sharing the grid's predicate (4), private items in the shared
activity feed (1), last-seen removed from the page open (4) and moved back
into the render (3, including the create test), the phone long-press (4),
the unknown-seen state flattened to false (1), and the search ranking (1).
The three new `smoke-layout` fragments cover the search screen and cards
10–12, the tray and the person week, and the two overlays.

**AMMAR IS A BOARD OWNER AND OVERRIDES ANY LOCK.** That premise has now
been got wrong in the first draft of a test in phases 3, 4 and 5. If a
lock assertion is about a refusal, the person in it is Daniyal.

## Acceptance script

The 15-step script from the build spec (§15), run manually as two users in
two browsers. **NOT RUN — the sandbox cannot sign in** (gstatic is
blocked, so `__bootApp()` never runs and the app stops at the login
screen's static HTML). It also cannot run until the three steps under
"Deploying the rules" are done, because there is no readable board before
them.

Record pass/fail here as it is worked through.

| # | Step | Needs | Result |
|---|---|---|---|
| 1 | a non-Board user signs in: no tab, a direct URL redirects | rules deployed | |
| 2 | Ammar creates a private item "test" → invisible to Afnan | rules | |
| 3 | Ammar assigns it to Afnan → it appears on Afnan's Dashboard and calendar | rules | |
| 4 | Afnan drags it to tomorrow → Ammar gets `moved`; activity shows it; "was" date shows | rules | |
| 5 | Ammar locks it → Daniyal's drag and `[` / `]` are refused "locked by ammar"; Afnan can move it and it logs as an override | rules | |
| 6 | Afnan presses Request move → a comment mentioning Ammar; Ammar's badge increments | rules | |
| 7 | Afnan adds 3 steps, completes 2 → "2/3" on every row | rules | |
| 8 | Afnan attaches an image → thumbnail renders; Ammar can open the full file | rules + Cloudinary | |
| 9 | Afnan hands over to Mustafa with a note → Mustafa notified, Afnan off it, comment posted | rules | |
| 10 | Mustafa marks done → off the Dashboard and calendar; Ammar notified; the list's Done section has it | rules | |
| 11 | quick add `denim samples @afnan #denim oct 5 !` → Oct 5, Afnan, denim, high | rules | |
| 12 | Ammar types `@` → the people he mentions most; typing `d` shows Daniyal | rules + a few real mentions | |
| 13 | phone: all four screens usable; drawer as a sheet; long-press move works | rules | |
| 14 | the seed re-run duplicates nothing | seed run once already | |
| 14b | the 08:00 PKT reminder writes one `due_today` per person on an item due that day, and the bell shows it | an item dated today; the first morning after it ships | |
| 15 | tests pass; nothing outside the Board changed | — | **pass** (below) |

**Step 15 is the one that can be answered from here.** At the end of
session 2 (`4ed7e5f`): `node tests/run.js` is **6,387 assertions, all
passing**; `smoke-board` drives three users through every Board page in
real Chromium; `smoke-layout` measures 362 fragment × width × theme jobs.
Outside its own files (`js/theboard.js`, `tests/theboard.test.js`, the
`BOARD*.md` docs) the branch changes exactly: `js/auth.js` (the landing
page), `js/shared.js` (the nav and phone More sheet), `css/main.css`,
`index.html`, `sw.js`, `netlify.toml`, `firestore.indexes.json`, the
vendored flatpickr and Lucide files under `assets/vendor/`, two Netlify
functions (`board-seed`, `board-reminder`) with their `scripts/` bodies,
the CI workflow, and these test files: `invariants`, `marketing`,
`smoke-board`, `smoke-browser`, `smoke-layout`, `board-seed`,
`board-reminder`. **`firestore.rules` is unchanged.**

### Session 2 acceptance — run on the first morning (prepared, not run)

Two people, two browsers. **Ammar** (a Board owner) and **Saim**, who is on
few items. Where a step says Afnan or Daniyal, anyone else on the Board will
do. Record each result in the right-hand column. Everything needs the branch
**merged and deployed**; "index" means the one composite index in the
batched list in `BOARD-LOG.md` is built.

| # | Step | Pass looks like | Result |
|---|---|---|---|
| S1 | Ammar signs in | lands on The Board's Dashboard, not the old dashboard | |
| S2 | Ammar → Settings (rail foot) → **Preview**, then **Run seed** | Preview says "nothing was written"; Run seed says it created 42 milestones and the list; Team Today lists all five | |
| S3 | Ammar presses **Run seed** again | "Created 0 milestones; 42 already on the board (not touched)." — nothing changes on any item | |
| S4 | Ammar deletes one seeded milestone, then runs the seed again | "Not brought back — deleted since the seed made it" | |
| S5 | Saim, in the second browser, keeps the Dashboard open; Ammar drags a milestone to another day | Saim's screen moves it within a few seconds, with no reload | |
| S6 | Saim opens a shared item he is **not** on | the pane says he can read and comment but not change it; no star, disabled tick; he can post a comment | |
| S7 | Ammar quick-adds `call baber tomorrow` and presses Enter twice fast | exactly one item appears, dated tomorrow | |
| S8 | Ammar opens a list, goes back to the Dashboard, quick-adds `note to self` | it lands in **no** list and stays private | |
| S9 | Ammar pins a task more than two weeks out (pane → **Pin**) | it appears on Deadlines; Settings lists it; **Unpin** removes it | |
| S10 | Ammar adds a marker "rehearsal" on 29 Oct in Settings → **Save Markers** | Saim's calendar and date picker show it without reloading | |
| S11 | Ammar types in an item's note, then opens another item within a second | the text is saved to the **first** item; the second item's note is untouched | |
| S12 | at a tablet width (about 800 px), open an item | the pane opens over the list; the list behind it is not squeezed to a sliver | |
| S13 | dark mode: open any date picker | the year arrows are visible; a picked day in the next month's grid is the accent colour | |
| S14 | after the index is built: open the Inbox | it lists Board rows only (no HRM notices); the browser console shows no "index not deployed yet" warning | |
| S15 | the first morning after it ships, 08:00 PKT | the bell has a "Due today" row for anything dated that day, one per person on it; `board_config/reminder` has the run summary | |

The Monday steps that **cannot** be pre-checked from a session are all of
them: nothing here has been seen in a signed-in browser (gstatic is blocked
in the sandbox). What *is* verified is listed per commit in `BOARD-LOG.md`.

## Tests

```bash
node tests/run.js theboard      # this module
node tests/run.js               # everything
node tests/smoke-browser.js     # every script loads in real Chromium
node tests/smoke-layout.js      # the shell's geometry and contrast
```

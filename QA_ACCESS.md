# QA / debugging access — the decision, the limits, the rollout

**Status (29 Sept 2026, branch `qa-access-v2`, local, nothing pushed, nothing deployed).**
`claude@groovy.op` is the account Claude Code's test harness signs in as. It is not
a person. Its identity, role, Board membership and write fences already exist on
`main` (BOARD.md → "The QA identity"); this branch adds **the read scope, the
emulator workflow and the proof**. Read that BOARD.md section first — this file
does not repeat it.

## 0. The decision (Afnan, 29 Sept 2026 — final)

> QA gets **read** access to every collection and path in Firestore and RTDB that any
> rule can read, including role-gated and owner-only collections. **Writes stay fenced.**

* **Reads:** one helper, `isQaRead()` (`isQa()` and `request.method in ['get','list']`),
  OR'd into every `allow read` in `firestore.rules` (91 of them). There is **no second
  `signedIn()` gate** — `signedIn()` is still `request.auth != null && !isQa()`, which is
  what keeps QA out of every write.
* **No match block** for `integration_secrets`, `passkeys`, `passkey_challenges`. They have
  none today; they are denied to everyone, QA included, and stay that way. There is no
  Storage in this project. **RTDB:** `database.rules.json` is byte-identical to `main` —
  its only rule, `attendance` `.read: auth != null`, already admits QA.
* **A guard for the future:** `tests/qa-read-guard.test.js` (CI) fails the build if a read
  rule is added that does not start `isQaRead() ||`, if a rule combines `read` with
  `write`, or if a match block appears for a credential collection.
* **Personal data is now readable by the harness** (payslips, CNICs in `employees`, bank
  details in `acct_*`). That is the decision, not an oversight; it means the QA password
  and the machine it lives on are as sensitive as an owner's. Fields cannot be hidden by
  rules — mask with `tools/qa-snapshot.js --mask-pii` before anything is copied.

## 1. What is deployed to live `groovy-gatepass` — verified from the repo, and what is not

| Question | Answer | Source |
|---|---|---|
| Are `main`'s `isQa()`/`authed()` rules published? | **No.** The last publish (28 Sept 2026, ~10:10 pm PKT, reported by Afnan) was the file at `md5 b68fc9febc14ec90ad3d29f860147702` = commit `430fc28`, and **that file contains zero `isQa()`** (checked: `git show 430fc28:firestore.rules \| grep -c isQa` → 0). `dc98484` (the QA rules) is not an ancestor of `430fc28`. Only `dc98484` and a merge have touched `firestore.rules` since. | `CLAUDE.md` "Firestore rules — published" (28 Sept entry) and "OUTSTANDING (26 Sept 2026, evening): the QA identity"; `BOARD-LOG.md` "OUTSTANDING (26 Sept 2026, evening)" |
| Does `claude@groovy.op` exist in live Firebase Auth? | **Unknown.** The docs only say Ammar creates it and sets its password in his shell (`BOARD.md` "The QA account and its environment"; `BOARD-LOG.md` "QA identity — Ammar's side"). Nothing records that it was done. | — |
| What can it do today, if it exists? | Everything an ordinary signed-in user can: `signedIn()` in the published rules has no `isQa()`, so it reads **and writes** most of the app. `BOARD.md` says so ("Deploy before the first sign-in"). | published rules = `430fc28` |

**Console checks (a human, ~2 minutes):**
1. Firebase Console → Authentication → Users → search `claude@groovy.op`. Exists? Enabled?
2. Firebase Console → Firestore → Rules → look for the text `isQa` (and `isQaRead` after the
   new publish). Absent = the account is unconfined **today**.
3. If the account exists and the rules are not yet published: **disable it now**
   (Users → ⋮ → Disable account) and leave it disabled until step 3 of §5.

## 2. Audit answers (from `origin/main`, then what this branch changed)

**2 · Can QA put real people on its lists/items, or reach a person through the reminder cron?**
Already blocked on `main`, in `firestore.rules`:
* `board_lists` create: `memberUids == [its uid]`, `qa == true`, `adminUid == its uid`;
  update: the same, so a real person cannot be added afterwards.
* `board_items` create: `assigneeUids == [its uid]`, `qa == true`, in a QA list it admins;
  update: `assigneeUids == [its uid]` again, owner must be QA.
* Comments and activity only on items it owns (`tbOwnsItem`).
* `board-reminder` (`netlify/functions/board-reminder.js`, Admin SDK, bypasses rules) notifies
  whoever is in an open item's `assigneeUids` (`scripts/board-reminder-plan.js` l.122); the
  fence above makes that list `[QA]`, so the cron can only write to `claude`'s own bell.
  **Residual, not closable by rules:** a Board owner (Afnan/Ammar) adding a real person to a
  QA item by hand would notify them. Don't. (The cron has no `qa` skip; adding one is a
  server change and was not made.)
* Verified in the emulator: putting a real uid on an item or a list — on create, and on update
  — is refused (`tests/rules-emulator-qa.js`, 4 checks).

**3 · Can QA write `hrm_notifications` rows that reach real users?** **`main` had a hole; it is closed here.**
`main`'s fence was `forUser == 'claude'` alone. The bell (`js/hrm.js` `_myHRMNotifs`,
l.2512-2518) shows a row to `forUser` **and** to a whole role when `forRole` is set — so
`{forUser:'claude', forRole:'owner'}` (or `'all'`) satisfied the fence and landed in every
owner's bell. Reproduced in the emulator first (the row was written), then closed:
`qaOwnNotice()` requires `forUser == 'claude'` **and** `forRole` absent/empty, on create and on
update (before and after). Under `main`'s rules that row also cannot be deleted by QA
(delete is `signedIn()`), so an owner would have to remove it. Checks: the matrix
(`forRole:'owner'`, `'all'`, adding `forRole` afterwards — all refused; a row for itself alone
still works) and, with the fence reverted, 3 fail by name.

## 3. Debug workflow

```
1  inspect   live, read-only      the QA account (reads everything now) or a Viewer-role key
2  snapshot  live -> emulator     node tools/qa-snapshot.js --mask-pii --clear-target --seed-auth …
3  reproduce in the emulator      http://localhost:8000/?env=emulator   (sign in as any role)
4  fix       in the repo
5  verify    in the emulator      and node tests/run.js
```

```bash
npm run emulators                                   # terminal 1: Auth + Firestore, demo-groovy-ops
GOOGLE_APPLICATION_CREDENTIALS=~/keys/groovy-viewer.json \
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
  node tools/qa-snapshot.js --mask-pii --clear-target --seed-auth --collections pos,bundles --limit 500
python3 -m http.server 8000                         # then http://localhost:8000/?env=emulator
```

* `?env=emulator` is honoured **on localhost only** (`js/env.js`); on the production host it is
  inert. A red bar says EMULATOR. Demo project id, fake API key, in-memory Firestore cache.
* The snapshot tool refuses unless the target is a `demo-` project on this machine, never copies
  the three credential collections, skips any document with a credential-shaped field or value
  (reports the *path* and reason, never the value), masks phones/addresses/CNIC/bank/names/outside
  emails deterministically, and refuses to run without `--mask-pii`. `--seed-auth` creates an
  emulator user per `USER_DEFS` entry with the password `qa-emulator-only`.
* Not emulated: Cloudinary, Netlify functions, Shopify/PostEx/Meta. Do not upload from an emulator
  session. `color-backfill.html`, `pantone-importer.html`, `store.html` initialise Firebase
  themselves and ignore `?env=emulator`.

## 4. Gaps the rules cannot close

| # | Gap | Effect | To close |
|---|---|---|---|
| 1 | `passkey.js` register/remove accept any valid ID token | QA can create/delete its own passkey documents (Admin SDK). It cannot mint a token for anyone else. **Also:** `BOARD-LOG.md` l.238 — whether a token minted from a custom token carries the `email` claim is unverified; `isQa()` and every owner rule read it, so a QA passkey sign-in could drop the fence. The harness never uses one. | 403 for `claude@groovy.op` in `register-options`/`register` (server deploy) |
| 2 | `link-preview.js` accepts any signed-in user | An SSRF-guarded outbound GET. No writes. | allow-list |
| 3 | Unauthenticated endpoints: `iclock`, `postex-status`, `image-search`, `shopify-order-backfill`, `shopify-inventory` | Reachable by anyone, QA included. Unrelated to the QA account. | separate hardening |
| 4 | `board-reminder` bypasses rules | §2 residual | discipline / a `qa` skip |
| 5 | Rules cannot hide fields | With read-everything, personal data in every allowed collection is readable | mask snapshots; protect the QA password like an owner's |
| 6 | Custom-token `email` claim | see #1 | verify with `getIdTokenResult()` |

## 5. Rollout checklist (hand-run, in order). Nothing below has been done.

0. **Establish the live state** (§1 Console checks). If `claude@groovy.op` exists and the
   published rules lack `isQa`, **disable the account first.**
1. **Write down the rollback.** The last published ruleset is `git show 430fc28:firestore.rules`
   (`md5 b68fc9febc14ec90ad3d29f860147702`). To roll back: paste that file into Firebase Console →
   Firestore → Rules → Publish (or `git show 430fc28:firestore.rules > firestore.rules` on a scratch
   checkout and `firebase deploy --only firestore:rules`). The Console also keeps its own rules
   version history — **not verified from here**. Note the rollback re-opens the unconfined-account
   state in §1, so re-disable the account first.
2. **Merge and check.** Merge `qa-access-v2` to `main` (PR); `git fetch` and confirm
   `CACHE_VERSION` is past both sides (branch = `v255`); CI green.
3. **Publish the rules:** `firebase deploy --only firestore:rules` from `main` (or paste the whole
   file). `database.rules.json`: **nothing to publish** (identical to `main`).
4. **Create / enable the Auth account** `claude@groovy.op` (Authentication → Add user) with a strong
   password set in your own shell only (`~/.groovy-qa.env`, `chmod 600`). Never in the repo, a log or
   a commit.
5. **Probe it before anything else uses it:**
   `QA_PASSWORD=… node tools/qa-probe.js --live` — creates nothing except probe documents that the
   rules must refuse (any that land are deleted and it exits 1 with the kill switch). Reads: every
   collection 200, the three credential collections refused. Add `--sandbox-writes` only if you want
   it to create-and-delete a QA list/item/comment in live.
6. **Then** `node tests/e2e/board.e2e.js` (its containment gate now probes a write).
7. **Kill switch, any time:** Authentication → Users → `claude@groovy.op` → ⋮ → **Disable account**,
   then roll the rules back if they were the problem (step 1).

## 6. Tests (what ran, and how to re-run)

| Suite | Runs in | What it holds |
|---|---|---|
| `tests/run.js` | CI | all logic suites incl. `qa-access` (env switch, hygiene), `qa-read-guard`, `qa-snapshot` |
| `tests/rules-emulator-qa.js` | emulator, by hand | **read matrix** over every path parsed from the rules; **no-match-block**; **write matrix** (junk writes refused everywhere; a fence-satisfying create succeeds on exactly the declared set); the people/notification fences; the containment gate; **regression differential** — every non-QA persona × every path × get/list/create/update/delete, `origin/main` vs this ruleset. `QA_PATHS=<regex>` narrows it for mutation checks. |
| `tests/rules-emulator-board.js`, `-boards.js`, `rules-emulator.js` | emulator | `main`'s suites; 6 QA read-refusal cases in the Board suite became allows |
| `tests/rules-emulator-rtdb.js` | RTDB emulator | `database.rules.json` unchanged; QA reads attendance, writes nothing |
| `tests/qa-snapshot-emulator.js`, `tests/qa-probe-emulator.js` | emulator | the snapshot tool end to end; the probe against the new rules, today's published rules, and `main`'s |
| `tests/e2e/board.e2e.js --stub` | headless Chrome | same 153/157 on `origin/main` and here (4 pre-existing pill-ellipsis failures) |

**Declared QA write set** (everything else refused): `board_lists`, `board_items` (+ `comments`,
`activity`), `hrm_notifications` (its own, no role), `user_profiles` (its own row), `mood_boards`
(its own PRIVATE boards, shared with nobody; + `comments`, `presence`, `activity`, `trash`).

Emulator recipe: `mkdir -p /tmp/emu && cd /tmp/emu && npm init -y && npm i firebase-tools@13
@firebase/rules-unit-testing firebase firebase-admin@13`, then
`EMU_DEPS=/tmp/emu/node_modules /tmp/emu/node_modules/.bin/firebase emulators:exec --only firestore
--project demo-qa "node tests/rules-emulator-qa.js"`. Every project id is `demo-…`; nothing can reach
`groovy-gatepass`. **What none of this can tell you is what the Console has published.**

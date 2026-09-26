# The Board — session 2 run log

Continuous run: P0, then P1, then P2, per the session-2 brief and Ammar's
decisions of Sat 26 Sep 2026. One commit per item, pushed to
`claude/session-brief-spec-setup-g0dofb` immediately; `CACHE_VERSION` bumped
past `origin/main` on every commit.

**Nothing here reaches the live site until the branch's PR is merged into
`main`** — Netlify deploys `main` only.

Every commit below passed, before it was pushed:
`node --check` on every script, `node tests/run.js`, and
`node tests/smoke-board.js` in real Chromium (plus the other smoke tests
where the commit touched what they measure).

Lines marked **→ NEEDS YOU** are actions for a human.

---

## Decisions taken mid-run (the conservative option, per the brief)

- The run brief's P2 list arrived truncated after "08:00 PKT reminder as a
  scheduled Netlify function (due_today +". P2 is built from the approved
  plan: the reminder (due_today + overdue, deduped per item per day), the
  admin screen (markers + pin), the inbox listener's source filter, cached
  lookups, and the acceptance-script prep.

---

## Commits

| # | Commit | What | CACHE_VERSION | Tests |
|---|---|---|---|---|
| P0.1 | `c06ad14` | **Calendar freeze.** `window.tbCalFilter=` (dropdown handler) replaced the pure `function tbCalFilter` — one binding in a browser — so the calendar recursed into its own repaint (~17s lock, then stack overflow). Handler renamed `tbCalSetFilter` (definition + 4 dropdowns; the by-person call at the old line 3220 already calls the pure filter and resolves correctly now). The handler refuses unknown keys. Stored prefs are REBUILT from the six known keys on load; anything over 4 KB or unreadable is removed. New repo-wide invariant: no `window.X=` may replace a same-named top-level function (self-alias and capture-and-call wraps allowed). New `tests/smoke-board.js` + CI step: real Chromium, every Board page, every calendar toolbar control, three modes (Ammar, Saim, Ammar with the 1.36 MB junk filter); freeze detected structurally by repaint nesting, not the clock (virtual time freezes `performance.now()`). **Proven against the shipped file: all three modes fail (stuck page); all pass on the fix.** | v166 | run.js 5,487/5,487 · smoke-board 3/3 · smoke-browser 7/7 · smoke-startapp 4/4 · smoke-layout Board fragments 54/54 |
| P0.2 | `a96cddb` | **People.** Nothing on the Board loaded the profile DIRECTORY (only your own row, from profileBootstrap), so every other person rendered as "someone", Team today listed one person, and the assign chips, @mentions, handover, the person filter and bell addressing (`_tbNotify` needs a handle) all knew nobody but you. New `tbPeople()` resolves the five Board users from profile rows (or the session, for yourself); `loadTbData` now loads the directory (`loadProfiles`) with the Board data and names `user_profiles` in the warning strip if refused. Team today lists **all five from day one** ("not set up yet" where no profile row exists) — so the one-sentence empty state now keys off YOUR column only (two old tests encoding "no team card on an empty board" rewritten to the new rule). The drawer lists all five, a not-set-up person disabled and saying why. `@afnan` in quick add is an assignee; a Board person with no row yet is **never title text** — taken out, named in the preview and a toast. | v167 | run.js 5,511/5,511 · smoke-board 3/3 (88 checks each: five Team rows, no "someone", @afnan → assignee) · smoke-browser 7/7 · smoke-startapp 4/4 · layout Board 54/54 |
| P0.3 | `14ad9f3` | **Live items.** The board was read ONCE per session (again only after a refused write or a Retry), so a date moved by one person never reached another's open screen. Now the same four queries `loadTbData` reads (shared items, my items, shared lists, my lists) plus the markers doc are LISTENED to. The first paint stays on `getDocs` (the harness's `onSnapshot` never fires and every suite depends on it); listeners start after it with per-query maps seeded from that read, and each snapshot replaces only its own map, so a listener that has not delivered never drops what the screen showed. **A remote update never repaints mid-gesture**: data is taken at once, the repaint waits while a field has focus or a pill is being dragged, and lands on focusout/pointerup (700 ms retry). Off the Board: memory updates, nothing paints. No listener in an old cached shell → the board stays static, as before. Sign-out reloads the page, so no listener outlives a session. **Cost:** each listener's first snapshot re-reads its query once per session (~50 docs at today's size). | v168 | run.js 5,531/5,531 · smoke-board 3/3 (94 checks each: a colleague's write lands without reload, waits while typing, lands on blur, a remote delete goes) · smoke-browser 7/7 · smoke-startapp 4/4 |
| merge | *(this commit)* | Merged `origin/main` (Afnan's Store Accounts edit + warehouse-sales review fixes, `v166`). Conflicts only in `sw.js` (`CACHE_VERSION` v168 vs v166) and `index.html` (the `main.css` `?v=` tag); resolved **past both** — the merge is new bytes. | v169 | run.js 5,722/5,722 (includes main's new suites) · smoke-board 3/3 · smoke-browser 7/7 · smoke-startapp 4/4 · **full** smoke-layout 304/304 |

---

## Rules / index deploys — batched

Nothing yet.

## → NEEDS YOU

- **P0.2 — press "Sync accounts" once** (Profile page → Team card, owners
  or Mustafa) so every Board person has a profile row. Until someone has a
  row they show on the Board as "not set up yet" and cannot be assigned.
  (P0.4's Run seed button also writes these rows.)
- **P0.1:** anyone who clicked Calendar before this ships has up to 1.36 MB
  of junk in their browser's storage. Nothing to do — the fixed loader
  deletes it on the first Calendar open.

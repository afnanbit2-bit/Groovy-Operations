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
| P0.1 | *(this commit)* | **Calendar freeze.** `window.tbCalFilter=` (dropdown handler) replaced the pure `function tbCalFilter` — one binding in a browser — so the calendar recursed into its own repaint (~17s lock, then stack overflow). Handler renamed `tbCalSetFilter` (definition + 4 dropdowns; the by-person call at the old line 3220 already calls the pure filter and resolves correctly now). The handler refuses unknown keys. Stored prefs are REBUILT from the six known keys on load; anything over 4 KB or unreadable is removed. New repo-wide invariant: no `window.X=` may replace a same-named top-level function (self-alias and capture-and-call wraps allowed). New `tests/smoke-board.js` + CI step: real Chromium, every Board page, every calendar toolbar control, three modes (Ammar, Saim, Ammar with the 1.36 MB junk filter); freeze detected structurally by repaint nesting, not the clock (virtual time freezes `performance.now()`). **Proven against the shipped file: all three modes fail (stuck page); all pass on the fix.** | v166 | run.js 5,487/5,487 · smoke-board 3/3 · smoke-browser 7/7 · smoke-startapp 4/4 · smoke-layout Board fragments 54/54 |

---

## Rules / index deploys — batched

Nothing yet.

## → NEEDS YOU

- **P0.1:** anyone who clicked Calendar before this ships has up to 1.36 MB
  of junk in their browser's storage. Nothing to do — the fixed loader
  deletes it on the first Calendar open.

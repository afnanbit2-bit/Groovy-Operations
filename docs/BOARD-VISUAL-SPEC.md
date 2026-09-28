# The Board — visual spec

What the board-tester agent judges every screenshot against
(`.claude/agents/board-tester.md`). **Written 28 Sept 2026 from what has
shipped** — the session-2 log (BOARD-LOG.md, P0.5–P0.7, P1.1–P1.8 and the
R-* review fixes). The brief's section 3 and change order 2 were not
available when this was written; when they arrive, what they say replaces
anything here that disagrees, and the disagreement is noted in the log.
Each rule names the log entry it comes from.

## Open against change order 2

- **The calendar grid.** P1.6 shipped a *hairline* grid (cells share 1px
  borders). The tester's checklist names "hairline grid" as a deviation, so
  change order 2 presumably replaces it. Until it arrives, report the grid
  as it is and do not fail it.
- **Avatars with photos.** Board avatars (`.tb-av`) draw initials only
  today. The checklist's "initials where a photo exists" is a change order 2
  item; the harness checks only that no avatar is empty.
- **Default views and "pure black cells".** Not defined by anything
  shipped; they come with change order 2.
- **A calendar Day view and a list's Calendar / Lanes / Members tabs** are
  not built. The harness names them as not built rather than testing them.

## Tokens (P1.1)

- Neutrals: Radix **slate** 1–12; accent: Radix **blue** 1–12, light and
  dark. Shadows and easing copied from Open Props (shadow-3, ease-out-3).
- Type scale **12–28 px**. **No text under 12 px** on a Board screen.
- Spacing 4–32 px; three radii; a mono stack for figures.
- Measured contrast decided two things: white on blue-9 is 3.26:1, so the
  **accent fill carries icons only** (`--tb-accent` is blue-11 in light,
  7.4:1 under white); ink on an accent-tinted chip is **blue-12**.
- Icons are Lucide from the vendored sprite, drawn in `currentColor`. A
  name not on `TB_ICONS` renders nothing (never a broken `<use>`).
- The item palette (`.tb-c-*`) is **variables with a dark set** (P1.6):
  every colour reads at least 5.6:1 on a dark card; sand is darkened in
  light (3.77:1 on white). Pills and dots use the same variables.

## Naming and case (P0.6, P0.6-fix, P1.8)

- The module is **"The Board"**. Milanote is **"Milanote"** (change order 1:
  never "Creative Hub" on screen).
- **Title Case** for the rail (Dashboard · Calendar · Lists · Inbox), every
  card and group title, section headers (Files, Comments, Activity, Hand
  Over, Keyboard, Move To, Inbox), the calendar range ("October 2026",
  "12 Oct – 18 Oct") and button labels. Body copy is sentence case.
- **No `.tb-` rule transforms case** — what is typed is what shows.

## The frame and the rail (P1.2, P1.4, R-tablet, R-rail)

- **Desktop ≥1024:** a **240 px rail** — icon + label on every entry,
  count pills (Dashboard = overdue + due today for you, red ink only when
  one is overdue; Calendar = your open dated items this Mon–Sun week;
  Inbox = unread), a Lists group (each list with team/private icon and
  open count; the open list marked), a foot with "+ New list" and, for
  owners, Settings. The active entry is a soft accent row with a 3 px
  accent bar. Content stops at **960 px** (the calendar keeps full width).
- **Tablet 640–1023:** the same rail, **56 px, icons only**, counts as
  corner badges.
- **Phone <640:** a strip across the top, icon over label.
- The search box and "?" sit in a **header row** on every screen.
- With many lists on a short screen, only the Lists group scrolls; Inbox
  and the foot never go under it.
- **The item pane** (P1.4): at ≥1440 it is the frame's third column, sticky,
  with the list still on screen and the open row marked; 1024–1439 the same
  with the rail folded to 56 px; below 1024 a panel over the page; on a
  phone a full sheet. At 640–1023 the list is never crushed (R-tablet: it
  was once 116 px wide).

## The row (P1.3)

- A **round checkbox**; the title on **up to two lines**; a **meta line
  under it** (colour dot, kind, date with icon — "Today", "Oct 2", red only
  when overdue — steps, comments, lock, the list when off its own screen,
  the other assignees), wrapping rather than overflowing; a **star on the
  right** for My Day. **44 px minimum, 48 on a phone.**
- A row with nothing to say has **no meta line**.
- Each list's done items sit in a **Completed** group at its foot, open by
  default, most recent first.
- Someone not on the item sees no star and a disabled tick that says why
  (R-noton).

## The Dashboard (P1.5)

- Left: ONE surface of collapsible groups — Overdue (count red), Due
  Today, My Day, Assigned to Me, Needs a Date, Next 7 Days. An empty group
  is not drawn. The fold is remembered per viewer.
- Right: exactly Assigned by Me, Deadlines, Inbox (five newest, unread
  first), Team Today, Activity. No "My Lists" chips.
- Columns 1.55 : 1, stacking whenever the content is narrow (a container
  query, so the pane opening beside it stacks them too).
- Team Today: only the overdue count is red; a name never crushed to 0 px
  (P1.8).

## The calendar (P1.6, P1.7, CO-5)

- Month and Week; weeks start **Monday**; every cell under its own weekday
  header, every pill in its own date's cell (CO-5, checked by geometry).
- Weekends tinted, out-of-month days dimmed (still drop targets), **today
  an accent circle** on its number, a drop target ringed in the accent.
- **Month: three pills per day at most, or two and "+N more"**; the week
  shows every pill. **Every pill carries a lane colour** (`.tb-c-*`) and
  its colour bar.
- Markers are flag chips on their day. The tray is "Unscheduled".
- Toolbar: ‹ Today › and the range; Month | Week (+ By Person) and Me |
  Everyone as segmented controls; a row of **avatars** filters by person.
- Date fields are the vendored **flatpickr**, Monday first, "Tue 20 Oct
  2026" on screen, the drop's markers underlined; restyled onto the tokens
  in both themes — **no flatpickr colour may leak** (R-picker). On a phone
  the native picker.
- On a phone the calendar is Week only.

## Both themes, every width

- Light and dark both readable: no light-on-light or dark-on-dark, every
  control legible (the layout suite measures contrast on each fragment).
- **Nothing clipped at 390 px**: no text wider than its box, no control off
  screen, no horizontal page scroll.
- No console errors and no uncaught exceptions on any screen.
- A screen paints within **500 ms** of navigation (the harness measures
  from `showPage` to two frames after the content is in).

## Milanote (change order 1)

- No browser `prompt()` / `confirm()` / `alert()`: its own dialog, centred
  on desktop and docked to the bottom on a phone, the confirm button saying
  what it does, destructive ones in the urgent colour.
- Renames happen **in place** (board title, card name on F2, "Rename the
  board…"): Enter or leaving commits, Escape reverts, empty reverts.
- On a phone the board's back button is the arrow alone.

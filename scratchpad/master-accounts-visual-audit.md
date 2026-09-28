> Model output, 28 Sept 2026: a subagent report behind MASTER_ACCOUNTS_PLAN.md §16.5, kept as evidence and read as such. It measured the v3 specimen; the probe scripts it names were session tooling and are not in the repo.

# Master Accounts specimen — visual audit and spec

**Method.** Rendered in headless Chromium at 1440×1400 (frame 1,180px, content column 926px) and at a 1,000px window for the true 390px phone frame; a DOM probe (`scratchpad/probe.js`, `probe2.js`) read counts, computed font sizes, borders, backgrounds, heights and y-positions. Six renders were looked at. Every px value and count is a measurement; §2–§4 are judgement unless they cite one.

## 1. The bulk, in numbers

| | Overview | Couriers | Ledger | Vendor |
|---|---|---|---|---|
| `main` height @1440 | **2,532px** | 2,077px | 1,000px | 1,539px |
| Visible elements / words | 540 / 942 | 393 / 700 | 143 / 234 | 228 / 410 |
| `.card` / `.kpi` / `.alert` | 8 / 6 / 4 | 8 / 5 / 3 | 1 / 0 / 0 | 5 / 4 / 0 |
| Charts | 3 plots + 3 bar lists + 12 map tiles + 30 cells | 2 | 0 | 1 |
| Tables shown (rows) | 0 (5 hidden twins) | 6 (30) | 1 (10) | 4 (19) |
| Chips / buttons / pills | 5 / 3 / 2 | 8 / 2 / 21 | 11 / 2 / 15 | 0 / 4 / 11 |
| Distinct font sizes | **8** (10·11·12·13·13.5·19·25·31) | 6 | 4 | 5 |
| Text elements ≤12px | **236 of 288 (82%)** | 97 of 228 | 25 of 83 | 51 of 134 |
| Elements at 10px (floor 11) | **31** | 0 | 0 | 0 |
| Uppercase labels | **49** | 28 | 7 | 27 |
| Bordered boxes / nested | **66 / 41** | 27 / 3 | 14 / 0 | 14 / 2 |
| Horizontal rules | 28 | **155** | 78 | 103 |
| Background / text colours | **12 / 7** (+7 chart hues) | 5 / 7 | 5 / 6 | 4 / 6 |
| First chart or record table at y= | **1,183** | 520 (table 906) | 219 | 609 |

No screen renders one element at 14 or 15px, the app's body size. The sidebar carries **24** items (19 under Accounts), ≈912px of navigation. At a 900px viewport the overview shows title, five chips, six tiles (177–480), four alert bars (492–747) and the first calendar row — about **20 bordered boxes and no chart**. The phone overview is **4,356px** tall (header 149, tiles 547, alerts 450, calendar 798).

### The ten worst offenders
1. **`.kpi-grid` › `.kpi` (overview).** Six tiles, 303px. The `auto-fill` grid resolves to five columns, so row two holds two tiles and **three empty cells**. `.kpi-sub` runs to 28 words / 3 lines: the holder breakdown — the page's most important table — is unaligned prose in a tile.
2. **`.alerts` › `.alert` ×4.** 255px, 140 words; each a coloured `.ic` disc, bold lead, body sentence and orange `.act` link; four full-width bars directly under six tiles.
3. **`.cal` › `.cal-d` ×30.** 78px bordered cells inside a card; weekday `small` at **10px uppercase**; amounts ellipsised in nearly every cell ("+Rs0.4L Pa…"); three fill states, a key, a 61px `.basis` — 413px.
4. **`.card-title` ×8 + `.basis` ×5 + `.tv`.** 12px uppercase letter-spaced header with a full-width underline, dashed footer rule, bordered "Table" pill: every card is a box with a header bar and a footer bar.
5. **`.smap` + `.r100`.** 501px. Rupee-sized tiles give 58px slivers ("Courier f…", "Run…", "Sub…"); three tints, a key, then a seven-colour strip of the same money, a paragraph and a hidden table — two visualisations of one dataset.
6. **`#sidebar .nav-sub` ×19.** Navigation taller than the viewport; each page then repeats a chip row and 2–4 buttons.
7. **`.grid2 › .card › .plot`.** 190px plots in 457px cards (59%); bars `max-width:24px` in 60px columns; chrome ≈ 40% of each card; a 2×2 grid of them; the stacked chart carries data labels, a y-axis and a legend at once.
8. **`.tag` / `.src` pills.** 21 on couriers, 15 on the ledger, 11 on the vendor; a grey "Store Accounts" capsule in every ledger row; green "matched / allocated / complete" pills on five of eight vendor rows — the normal state as a badge.
9. **Courier profile cards ×5** (739px): static key-value facts ("Feed: later — least priority"), each under an uppercase title with a pill.
10. **`.page-head` + `.filters` + `.btn-row`.** Two-line explanatory subtitles (couriers 88px), 5–11 pill chips (the ledger's wrap to 76px), 2–4 bordered buttons; plus `.kpi.warn`/`.kpi.bad` tinted tiles.

## 2. Why it reads as bulky
- **Container-dense, information-sparse.** 66 bordered boxes for roughly 45 figures: every fact is wrapped, so frames outnumber content. Five radii on one screen (16 / 14 / 10 / 8 / 999).
- **Hierarchy from boxes and capitals, not type.** One 19px title, then 11–13.5px everywhere; six 25–31px numbers of equal weight, so nothing leads. The explanations (alerts 13.5px, basis 12px muted) read as fine print — yet they are the "money speaks" content.
- **Repetition.** Four-part chrome on eight cards; the same fact three to five times (Friday's CPR: a tile, an alert, a calendar cell, a courier tile, a courier alert).
- **Colour noise.** Twelve background and seven text colours on one screen; semantic tints as fills instead of marks; green money in 21 calendar cells; orange links; icon discs.
- **Charts as thumbnails with full chrome**, and two charts of the same data.
- **Alignment defects.** Grid holes; ledger rows 55px because "27 Sep" wraps in every row; vendor rows 55px from wrapping documents; numbers set in prose.
- **The record is below the fold** on couriers (y=906) and the vendor page (y=609), behind the tiles and alerts that summarise it.

## 3. Visual specification (plain CSS, existing tokens)

**Spacing.** 4 / 8 / 12 / 16 / 24 / 32 / 48. Page gutter 32px (24 under 1200px); sections 32 apart; title to content 12; rows 8; inline 8. Content `max-width:1100px`.

**Type.** Page title 22/600/1.2. Section title 15/600/1.3, sentence case, no rule. Body and table text 14/400/1.4 (15 for prose). Hero number 28/600/1.15, `letter-spacing:-.01em`, tabular-nums; secondary numbers 20/600; table money 14/500. Labels 12/500 `--muted`, sentence case — **no uppercase, no letter-spacing** in the module. Meta 13/400 `--muted`. 11px for axis ticks only; nothing under 11.

**KPI tiles.** Only on the overview and a party page; at most **four**, one row, `repeat(4,1fr)` never auto-fill; unbordered — a stat row on the surface, stats divided by a 1px `--border` left rule and 24px padding; label, number, one sub-line of ≤8 words or a delta; no tints, no sparkline. A list (cash by holder) is a table.

**Concerns.** A plain list under "Needs attention · 3": an 8px dot in `--accent-urgent`/`--accent-warning`, one 14px sentence with its numbers in 500, the action as a trailing `--link-accent` link. No box, disc, bold lead or fill. "Fine" is silent; a reconciled state is header meta. Show three; "and N more" opens the rail. In tables, a state is the dot or a 12px word in the state colour; a filled pill only for `void`.

**Tables.** Rows 40px (36 compact), 14px; header 12/500 `--muted` sentence case over one 1px `--border`; separators 1px `--soft` or none with `--hover`; date `white-space:nowrap` at 88px; money right-aligned tabular-nums in fixed widths, balance 500; only the description wraps; source as 13px muted text; totals 600 with a top rule; a full-width table sits on the page under a section title, never in a card.

**Charts.** One per section, at most two per page above the drill-down, full width or two-thirds with the numbers beside; plot 240px (200 min); bars 32–48px, gaps ≥ half a bar; four gridlines, 11px ticks; no legend for one series, an inline title-row legend for two; data labels **or** a y-axis, never both; "Show as table" is a text link beneath. No grids of charts; `--chart-*` only inside a plot.

**Colour.** One accent: `--dark` for the primary button and selected control, `--link-accent` for links. Semantic colours as dots and words only — never a fill, never on money except a negative. Everything else neutral tokens.

**Borders, shadows, radius.** No shadows. One 1px `--border` on an outer container only; nothing inside a container is bordered (rows use `--soft` hairlines; a cell takes `--surface-2` **or** a border, never both). Containers 8px, controls 6px, pills only for the period segment. Default is no container: sections on `--bg`. A card only for a thing lifted as a unit — the rail, a form, an error.

**Page header.** One sticky 56px row: title 22px with a 13px meta line ("Sun 27 Sep · MCB reconciled to 25 Sep · 41/41") · segmented period control (This month / Last month / Quarter / Year; a date-range control instead of "Custom…") · **one** `--dark` primary button · a "⋯" overflow. No explanatory sentences.

**Drill-down rail.** A 380px right panel (`position:sticky;top:0;height:calc(100vh - 52px);overflow:auto;border-left:1px solid var(--border)`), main `minmax(0,1fr)`; opens on a row, stat, day or spend line and holds the detail: basis text, six-month bars, terms history, the receipt. Whatever explains lives there or in a tooltip, never on the page. Under 1200px a slide-over; on the phone a bottom sheet.

**Empty and loading.** Loading: the app's `.gv-skel` shimmer in the section's shape. Empty: one 14px muted line with the action as a link ("No CPRs this month · Collect a CPR"). Failure: the app's error card naming the collection, with Retry.

**Phone rule.** Same order, stacked; the stat row 2×2 without borders; charts 180px; the calendar a list of days; tables as the app's flex-card rows, money right-aligned; the rail a bottom sheet. A cell that would truncate becomes a list row.

## 4. Per screen

**Overview.** Above the fold: header (Accounts · period · + Journal entry); a four-stat row (Cash 28.57 lac hero · In 64.90 · Out 54.00 · owed minus owing as one net line); "Needs attention" with three lines; then, side by side, the cash-by-holder table (seven rows, each opening the rail) and the balance line with its 30-day projection at 240px. Below: the 30 days as a seven-column strip, one row per week, only event days carrying text, tight/short days as dots; the spend list (twelve rows: name · amount · proportional bar · state dot); aging as two four-row tables. Delete: the Rs100 strip, sparkline, five basis paragraphs, five Table pills, "Cash in and out by week" (the balance line says it), "Biggest vendors" (→ Purchasing), "Revenue by channel" (→ P&L), the 19-item sub-nav (six entries plus More). Phone: stats 2×2, attention list, holder table, balance chart; the rest linked.

**Couriers.** Above the fold: header (Couriers · September · Collect a CPR), three stats (in transit, to collect, collected), two attention lines, then the **CPR table full-width**, eight rows. Below: the rhythm chart, then the cost chart, each full width; the five profile cards become one table (courier · how it pays · owed · last statement · state), terms in the rail. Delete the two-line subtitle, the Blue-Ex tile, 21 pills. Phone: stats, attention, CPR rows as cards.

**Ledger.** Already the model; keep it. Filters on one row: period · Source select · Account select · search (11 chips → two selects); the table on the surface, 40px rows, date nowrap, source as text; footer "2,184 postings · 6 sources", explanation in a tooltip; Excel/PDF in ⋯. Phone: rows as cards, filters in a sheet.

**Vendor.** Above the fold: header (Al-Hamd Garments · "Vendor · stitching, washing · credit 30 days · active" · + Bill; the rest in ⋯), three stats (we owe with due date · open orders · reliability), an aging line ("Current 311k · 31–60 86k · 60+ 24k"), then the **ledger full-width**. Below: open POs, two rows. Rate card, terms and both histories move to the rail under "Terms & rates". Delete: the amber tile, the green normal-state pills, two basis paragraphs, the Aging card. Phone: stats, aging line, ledger rows as cards.

## 5. Measurement vs judgement
Measured: every count, height, position, font size and colour tally above; the app shell's 220px sidebar, 19px page title, 11px uppercase KPI labels and 77 `box-shadow` declarations (from `css/main.css`). Judgement: §2's causes, every size and limit in §3, what §4 deletes or moves. Not verified: the module inside the real app (the sandbox cannot sign in); the phone was measured, not looked at.

> Model output, 28 Sept 2026: a subagent report behind MASTER_ACCOUNTS_PLAN.md §16.5, kept as evidence and read as such. Quotes are from the Polaris, Carbon and Primer repositories, read over raw.githubusercontent.com; lines marked [inference] are the agent's own.

# Design-system rules for a data-dense finance/admin UI

Read 2026-09-28 via `raw.githubusercontent.com` (API listing gated, docs sites blocked — nothing rendered was seen). Quotes verbatim; "→" paraphrase; **[inference]** mine. Polaris px values are from `polaris-tokens/src/size.ts`.

## (a) What I read (18 files; 4 are token sources, 1 a stub)

| Repo · path | Gave |
|---|---|
| Shopify/polaris · `polaris.shopify.com/content/design/layout/index.mdx` | proximity, emphasis, "software, not website" |
| … `content/design/typography/index.mdx` | hierarchy by weight/size/colour/position; tabular numbers |
| … `polaris-tokens/src/themes/base/{space,font,breakpoints}.ts` + `src/size.ts` | space/type scales, semantic tokens, breakpoints |
| … `content/patterns/card-layout/index.mdx` | card anatomy, gap ladder 4/8/12/16 |
| … `content/components/layout-and-structure/page.mdx` | page header, breadcrumbs, one primary action, widths |
| … `content/components/tables/index-table.mdx` | list tables: alignment, >50 paginate, row tones |
| … `content/components/tables/data-table.mdx` | analytics tables: totals, alignment, units |
| … `content/components/feedback-indicators/banner.mdx` | alert placement and restraint |
| … `content/components/feedback-indicators/badge.mdx` | status chips; the financial tone vocabulary |
| … `content/patterns/resource-index-layout/index.mdx` | stub only |
| carbon-design-system/carbon-website · `src/pages/components/data-table/usage.mdx` | density, toolbar, row actions, zebra, skeletons |
| … `src/pages/components/data-table/style.mdx` | row heights 24–64, table type, padding |
| … `src/pages/elements/spacing/overview.mdx` | spacing scale; density and white-space |
| … `src/pages/data-visualization/dashboards/index.mdx` | KPI hierarchy, limit metrics, F-pattern |
| primer/design · `content/ui-patterns/empty-states.mdx` | empty vs error copy, one action |
| … `content/ui-patterns/data-visualization.mdx` | chart anatomy, legend rule, 3:1 marks |

## (b) Distilled rules

### Page layout & hierarchy
- "Space defines proximity … Group similar data points or tasks in the same card … Nest inset shapes and surfaces." (Polaris `design/layout`)
- "Use size, weight, and contrast to establish hierarchy … Divider lines are used to delimit rows of information in data and index tables, and rarely for dividing information elsewhere." (Polaris `design/layout`) → borders belong to tables; cards separate by space and surface.
- "Compact elements add detail, and larger elements command more attention." Don't "contradict the importance of a task with its size." (Polaris `design/layout`)
- Card = header, body, footer. Title states purpose; "Use the object type as card title when the card is a list of objects." Header actions are "tertiary icon buttons"; call-to-actions sit in the footer, right; list actions footer-left; "Table actions are placed to the right in the header." Don't let cards grow "so tall that they are difficult to overview"; align content "along both the left and right edge … optically". (Polaris `patterns/card-layout`)
- "The most important data should have the highest contrast and occupy the largest area … Place the most important at the top of the page and follow the F-pattern … Limit the number of metrics." (Carbon `data-visualization/dashboards`)
- "Sections of a UI are allowed to be dense, but the whole page should not be crowded"; more surrounding space reads as more important. (Carbon `elements/spacing`)
- "Full-width — Use for layouts that benefit from more screen width, such as wide tables or lists"; narrow width only for "a single unified task". (Polaris `page.mdx`)

### Spacing & density
- Polaris scale (px): 0 · 1 · 2 · 4 (`space-100`) · 6 (`150`) · 8 (`200`) · 12 (`300`) · 16 (`400`) · 20 · 24 · 32 · 40 · 48 · 64 · 80 · 96 · 112 · 128. Semantic: card padding = card gap = 16; **table cell padding = 6**; button-group gap = 8. (`space.ts`, `size.ts`)
- Carbon scale (px): 2 · 4 · 8 · 12 · 16 · 24 · 32 · 40 · 48 · 64 · 80 · 96 · 160. "Deviating from the spacing scales should be avoided." Responsive: "at 1440 px `padding-right: $spacing-05` [16] but at breakpoint 768px `padding-right: $spacing-03` [8]". (Carbon `elements/spacing`)
- Gap ladder in a card: "Space-100 [4] is the tightest gap … to group the most related elements" (label↔value, plain list rows); "Space-200 [8] … between the header, body, and footer in a card with a single section" and "between the heading and content of a card section"; "space-300 [12] between form layout items"; "space-400 [16] to separate card sections" — "default to space-200 and upsize to space-300 if the former seems too tight." "The deeper an element is nested, the smaller its padding is." Single-section cards omit the section title "however, maintain the space-200 gap." Padding for visibly bounded containers (a table header), gaps for invisible ones. (Polaris `patterns/card-layout`)

### Typography for numbers and labels
- "Use a combination of weight, size, color and positioning to define hierarchy" — never colour alone; "tabular number stylesets are employed for numbers and currency amounts." (Polaris `design/typography`) → `font-variant-numeric: tabular-nums` on every money column and tile.
- Polaris sizes (px): 11 · 12 · 13 · 14 · 16 · 18 · 20 · 22 · 24 · 30 · 32 · 36 · 40; weights 450 regular / 550 medium / 650 semibold / 700 bold; line-heights 12 · 16 · 20 · 24 · 28 · 32 · 40 · 48; tracking 0 / −0.2 / −0.3 / −0.54px (`font.ts`) → **[inference]** negative tracking only on tile numbers ≥ 24px.
- Carbon table type: title 20/400, column header 14/600, row text 14/400 (`data-table/style`) → header = same size, one weight up.
- Headers "one or two words"; "Include units of measurement symbols [in headers] so they aren't repeated throughout the columns"; "Keep decimals consistent"; sentence case. (Polaris `data-table`, Carbon `usage`)

### Tables
- "Numerical = Right aligned; Textual data = Left aligned; Align headers with their related data; Don't center align." (Polaris `data-table`) "Numeric cells and titles should be right aligned … use the numeric style." (Polaris `index-table`)
- "Include a summary row to surface the column totals. Not include calculations within the summary row." Totals may move to the footer where that reads better. "Wrap instead of truncate" — truncated titles sharing a first word all look alike. (Polaris `data-table`)
- Row heights: xs 24 · sm 32 · md 40 · lg 48 · xl 64; header row "should always match the row size"; xl only for two-line cells; 16px between columns; toolbar 48px with lg/xl rows, 32px with sm/xs. (Carbon `data-table/style`) → **[inference]** 32–40px is finance density; 48 where a thumb must hit.
- Colour: row text `$text-secondary`, `$text-primary` on hover; `border-bottom: $border-subtle`; column header and zebra rows `$layer-accent`. Row hover "should always be enabled"; zebra is an opt-in modifier for horizontal scanning. (Carbon `data-table/style`, `usage`)
- Sticky header and "fixed first columns" for wide tables (names must stay in view while reading the numbers); a named "increased density and zebra striping" variant. (Polaris `data-table`)
- Row `tone` subdued / success / warning / critical paints the background; subheader rows group "by a relevant data value"; "Paginate when the current list contains more than 50 items"; state the scope ("Showing 50 products"). (Polaris `index-table`)
- Toolbar "up to five actions"; fewer than three row actions → "keep the actions inline as icon buttons"; row menus on hover "to reduce the visual clutter"; give the table "the most width on the page". (Carbon `data-table/usage`)

### Metric / KPI tiles
- Stats are "cards that have a title and a larger stat number"; hierarchy comes from "larger, heavier, and contrasting elements". (Polaris `design/layout`) "Limit the number of metrics. Non-essential information should be provided as needed." (Carbon `dashboards`)
- Page-wide status is title metadata "immediately after the page's title … brief, important and non-interactive". (Polaris `page.mdx`) → "as of 27 Sept, 18:40".
- **[inference]** 3–4 tiles per row at 1440; number 24–30px semibold, label 12–13px muted, one 12px context line. A tile answers "how much"; a table row answers "which".

### Status, alerts, attention
- Banners: "used thoughtfully and sparingly for only the most important information"; "Not … the primary entry point to information or actions merchants need on a regular basis"; dismissible "unless they contain critical information". Page banners "at the top of that page, below the page header … full width"; section banners "inside that section, below any section heading … pared-back". "Single theme", "1 to 2 sentences", "no more than one primary action". Warning/critical "can be stressful … be cautious"; success → toast. (Polaris `banner`)
- Badges: "established color patterns", "short, scannable text", one word (two "for a complex state"), past tense. Financial vocabulary: "Authorized, Pending, Paid, Unpaid, Voided, Partially paid, Partially refunded, Refunded". Small size inside table cells. Attention = needs review; warning = time-sensitive, reversible, "only when absolutely necessary"; critical = irreversible. (Polaris `badge`)
- → **[inference]** rows carry status via badge/tone; the page carries at most one banner; many concerns live in a list card.

### Charts
- Required: header, subheader, axis labels, gridlines; "Only show a legend when showing more than 1 data set"; marks "at a 3:1 ratio with the background"; stacked segments need "a high contrast divider line"; bar/line/area/progress only — no donut or sparkline; offer "preview the data in a table and download … CSV". (Primer `data-visualization`)
- Same layout, spacing and legend position for every chart; "consistent colors for each data set"; annotate "trends, averages, peaks, and valleys". (Carbon `dashboards`)

### Navigation, page header, primary action
- "Always provide a title … Always provide breadcrumbs when a page has a parent page. Be organized around a primary activity … provide it as a primary button in the page header. Provide other page-level actions as secondary actions." Titles never truncate; list pages take the pluralised object name; labels verb+noun ("Create order"), a bare verb when the noun is the page ("Export"); action groups roll "up into a single action for smaller displays". (Polaris `page.mdx`)
- In cards "Only use a primary button when it's the most important action on the page"; ">2 call-to-actions → action list". (Polaris `patterns/card-layout`)

### Empty & loading
- "Use skeleton states instead of spinners" (Carbon `usage`); skeleton page "on initial page load" (Polaris `index-table`).
- Empty state: primary text explains "the purpose of the empty state", secondary text "what steps they might take next", "one primary link or action", optional text link; errors use the alert icon, "should not attempt to bring delight", state the problem "as specific as possible" without raw technical detail, and rarely have a secondary action; add a border when the empty state "is not the only content on the screen". (Primer `empty-states`)

### Phone / responsive
- Breakpoints xs 0 · sm 490 · md 768 · lg 1040 · xl 1440 (`breakpoints.ts`); the `condensed` table and hidden bulk actions only below 490 (Polaris `index-table`); header actions roll up (Polaris `page.mdx`); spacing drops a notch at 768 (Carbon `spacing`); row menus stay visible on touch (Carbon `usage`).
- **[inference]** below 490: tiles 2-up then 1-up; each table row becomes a stacked card (title left, money right, badge beneath); keep the totals row; drop the sticky header.

## (c) Apply to a finance overview page (1440px)

Top to bottom, per Polaris `page.mdx` / `banner` / `card-layout` and Carbon's F-pattern:

1. **Page header** — title "Accounts"; title metadata "as of Sun 27 Sept · closed to Aug"; breadcrumb only if there is a parent; **one** primary button ("Record entry"); secondaries ("Export", "Close month") collapsing to a menu on phones.
2. **One banner or none** — full width under the header, only for something needing action now ("Wednesday pay day: ₨X owed, holders can fund ₨Y", one CTA). Never a stack.
3. **KPI row** — 4 tiles, 16px gap: Cash in hand (largest, highest contrast), Owed to vendors, Due this week, Owed to us. Tabular figures, label above, one context line; no chart inside a tile.
4. **Two-column body** — **[inference]** ~2/3 primary + 1/3 secondary, the common Polaris split (its Layout doc was not read):
   - Primary, top: **Cash by holder** — card titled "Holders", 32–40px rows, 6px cell padding, columns Holder · Balance (₨) · Pending to confirm · Last movement; money right-aligned, units in headers, a totals row, borders only inside the table, hover on, warning tone only on a stale pending transfer.
   - Primary, below: **Due this week** — same grammar, subheader rows per day (Wed, Sat…), one financial badge per row (Unpaid / Partially paid), "Pay" inline as a ghost/icon button (<3 actions), paginate past 50.
   - Secondary, top: **Needs attention** — list card, one badge + one sentence per concern (attention / warning / critical by reversibility), each linking to its entry, footer-left "View all N", no primary button.
   - Secondary, below: **Owed** — top vendors by payable with an aging chip; "View vendors" as a tertiary header action.
5. **One chart at most** — the 30-day cash calendar or a balance line, in a card with header + subheader, legend only for two series, semantic colours, a table/CSV affordance.
6. **States** — skeleton while loading; an empty holder table says what would appear and offers "Record opening balance"; a refused read is an error card (alert icon, collection named, Retry), never an empty list.
7. **Phone** — actions collapse, tiles 2-up then 1-up, tables become stacked rows keeping right-aligned money and totals; **[inference]** the concerns card moves above the holder table — the F-pattern's top-right slot is gone, and concerns are why an owner opens the app.

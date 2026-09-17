# Pattern Hub — Master Plan

> Status: **BUILDING. M0–M6 shipped (17 Sept 2026); M7 (the coverage
> dashboard card) is the last one. The check-out log was dropped (D8).** Design agreed across three question rounds with Afnan. This document is the single source of truth for
> the module. Remaining open items are marked **[DECISION NEEDED]** and are all
> Ammar's calls on the TAC document; none of them block M0.
>
> Afnan's brief: *"a pattern hub for all the articles — fetch all active articles
> from Shopify so we can assign a physical pattern to them, take their
> measurements, and notify the cutting stall what to update on them. We assign
> codes to physical patterns from Groovy Ops. It's a logical system that has to
> work smoothly."*

## 0. The system in one picture

```
TAC registry (IN-APP, per category, mints codes)
   │
   ▼
ARTICLE  GST062 · brand · category · needsPattern
   │  many articles ─▶ one pattern            Shopify (READ-ONLY, daily rollup)
   ▼                                          supplies: active/draft/archived,
PATTERN = BLOCK  PTN-0042 "Live In Pants"     sizes seen, product photo
   ├── home:   hook 3 · slot 2   (all sizes of the block bundled in one slot)
   ├── sizes:  XS S M L XL       (the sizes physically in the bundle)
   ├── grid:   POM × size, inches (cm view), each POM with "how to measure"
   ├── revision ──▶ before/after diff ──▶ notice to cutting (Uzaib) ──▶ acknowledged
   └── label:  5 × 6 in PDF — code, articles, sizes, key measurements, QR
                    │
PO create ──▶ article ──▶ pattern code + hook/slot ──▶ on the PO + traveler PDF
```

**One sentence:** the physical craft-paper pattern gets a digital twin — its
identity (code), its home (hook/slot), its shape (measurements), and its users
(articles) — and every physical correction is mirrored in the twin, which is what
lets cutting be told exactly what moved.

## 1. Locked decisions

| # | Decision | Locked |
|---|---|---|
| D1 | **A pattern is a BLOCK; many article codes point at one pattern** | Afnan, 17 Sept |
| D2 | **One hook slot holds ALL sizes of one block, bundled** — a block is one physical item | Afnan, 17 Sept |
| D3 | The TAC list lives **in-app** — mint new codes per category, assign a code to any article missing one | Afnan, 17 Sept |
| D4 | Measurements are recorded per block per size, **inches stored, cm viewable** | Afnan, 17 Sept |
| D5 | Points of measure (POMs) are **editable in-app** — create / edit / delete — and each carries **how-to-measure instructions** | Afnan, 17 Sept |
| D6 | **5 × 6 inch label** per block, printed and stuck to the paper, reflecting live data | Afnan, 17 Sept |
| D7 | Storage is a **fixed grid: 10 hooks × 5 slots** | Afnan, 17 Sept |
| D8 | **No check-out / check-in log** for now | Afnan, 17 Sept |
| D9 | Caps (`GHW`) and any future non-garment article: **in TAC, get codes, `needsPattern:false`** | Afnan, 17 Sept |
| D10 | **PO integration** goes live once articles are covered: the PO shows pattern code + hook/slot, on screen and on the traveler PDF | Afnan, 17 Sept |
| D11 | Test-phase audience: **Afnan, Ammar, Mustafa.** Uzaib's account manages cutting and joins when notices go live | Afnan, 17 Sept |
| D12 | Shopify is **read-only** for this module | Afnan, 16 Sept |

### Why we do not auto-derive blocks

Clustering the 395 GROOVY article names by style (colourway stripped) yields 251
candidate blocks. That overcounts badly: **90 of the 103 graphic tees cluster
separately only because each names its artwork, not its shape.** Counting the
print-on-blank categories — Graphic Tees 103, Sando 11, Baby Tees 19 = 133
articles — the realistic block count is **60–130**. Only the pattern master can
draw that line. So articles are seeded automatically, **blocks are created by
hand**, and clustering is offered in the unassigned queue as a suggestion
("these 14 look like one block — assign together?"), **never applied**.

### The capacity fact the hub must show, not hide

50 slots. 60–130 blocks. **"Not on a hook" is a normal state**, not an error; the
hook map (§5) shows occupancy honestly so a full rack is visible as a fact.
Whether the master prunes to 50, boxes the rest, or adds hooks is an operational
choice the tool must make visible rather than paper over.

## 2. Verified findings this plan rests on

Read from the live Shopify Admin API (read-only) and `TAC List Complete.docx`
(Google Drive, owner Ammar) on 16 Sept 2026 — a full census, paged to
`hasNextPage:false`, then cross-matched by code and by normalised title.

- **350 active products, 336 distinct article codes.** The SKU *is* the article
  code plus size (`GST073-XS`, `GD007-28`). The join key already exists.
- **The TAC List is the source of truth** across three brands: GROOVY (395 codes),
  Cultured Legacy (~48), Against All Odds (~63). `PRODUCT_CATALOG` in
  `js/shared.js` is a stale snapshot missing 88 active codes — **this module
  is not built on it.**
- Cross-match: 293 clean · 12 name mismatches · 30 spelling drift · 5 codes on
  Shopify absent from TAC · 60 TAC codes not active · **11 products with no
  usable SKU**.
- **Title matching recovers 7 of those 11** to existing TAC codes (all denim with
  an empty SKU: GD004, GD006, GD009, GD010, GD011, GD012, GD013). Four need a
  new code minted — `Trying Times`, `Keep Keeping It Positive`, `Anxiety Prime`
  (`GBT###`), `The Best Is Yet To Come` (v1; `GP035` is "2.0").
- **Three real errors** (confirmed by direct product lookup): the Jorts codes
  `GJO001`/`GJO002` are **swapped**; the `GCO001–008` co-ord codes are unused on
  Shopify and **duplicate** their `GHZ`/`GST` twins (one garment, two codes); and
  `GST062`/`GSO003`/`GB025` carry **renamed colourways** TAC never picked up.
- The **Chicago Bulls** product carries two codes (`GP060` Black, `GP061` White).
  One Shopify product ≠ one article.
- **Four size axes**: alpha (XXXS…XL), numeric waist (26…34), none (caps),
  legacy foreign SKUs. `PO_FLOW_SIZES` in `js/pos.js` (`XS…2XL`) covers none of
  the last three — **deliberately left alone** (shared operational code; the hub
  carries its own size list per pattern).

## 3. Actors

| User | Role | In this module |
|---|---|---|
| Afnan, Ammar | owner | Everything |
| Mustafa | manager, **by username** | Everything — matches the Sept 2026 `isMustafa()` grants |
| Arfat | manager | Nothing in the test phase (same precedent: holds the role, gets none of the grants) |
| Uzaib | `viewer`, Cutting & Fabric | **View** from the milestone the hub opens up; **acknowledge notices** from M5. Not in the test-phase nav |
| Hassan, Alam | cutting masters, no login | The ones who **trace** patterns; `tracedBy` picks from these two names, as the cut records already do |
| Uzaib | (as above) | **Manages** the patterns day to day — Afnan, Q28 |

## 4. Data model

Firestore, client SDK, window-bridged globals — like every module except
`js/store.js`.

### 4.1 `tac_categories/{PREFIX}` — the registry's shape

```
prefix     'GST'      brand 'groovy'     label 'Sweatpants & Trousers'
form       'NNN'      ('NNN' → GST001; 'NNN-TB' → GCO001-T / GCO001-B)
needsPattern  true    (false for GHW)
nextNumber 77         ← minting counter, seeded from today's max per category
```

**Minting is next-after-highest.** TAC's holes (`GH036`, `GS016`–`GS022`) are
human errors, not reservations (Afnan, Q19) — so nothing is *protected* in a gap,
but the counter still never fills one automatically: a gap is a sign someone
mis-typed, and silently landing a new article on that number would hide it.
An admin **may type an explicit unused code** on the mint form to fill a gap
deliberately; the transaction refuses any code that already exists. Minted in a
`runTransaction` on this doc, the same shape as `getNextId()` in
`js/shared.js:625`, and the `articles/{code}` create is in the **same
transaction** so the doc-id itself enforces uniqueness (the `creator_handles`
lock pattern from Marketing M1).

### 4.2 `articles/{CODE}` — the spine

```
code          'GST062'   (mirrors the doc id)
name          'Live in Pants | Heather Grey'
brand         'groovy' | 'cultured' | 'against'
category      'GST'
needsPattern  true       (inherited from the category, overridable per article)
patternId     'ptn_…' | null      ← THE LINK
active        true
source        'tac_seed' | 'minted' | 'assigned_from_reconcile'
createdBy/At, updatedBy/At
```

**The pattern link lives on the ARTICLE, never as an array on the pattern** — the
`columnId` lesson from Mood Boards. Assigning writes one document; two people
assigning different articles to the same block never collide; joining a block
never writes the block. "Which articles use this pattern" is a query. A stale
`patternId` is **inert** — renders unassigned, nothing reconciled on read.

### 4.3 `patterns/{id}` — the block

```
code        'PTN-0042'   (counters/main.patterns, via getNextId)
name        'Live In Pants block'
category    'GST'
fit         'Relaxed'
sizeAxis    'alpha' | 'waist'
sizes       ['XS','S','M','L','XL']     the sizes physically in the bundle
sampleSize  'M'                          the size the label leads with
hook        3 | null       slot  2 | null     ← null = not on a hook (normal)
tracedBy    'Hassan'       (free text)
pomTemplate 'pant'         (which POM set it starts from, §4.4)
extraPoms   ['drawcord_len']             per-pattern additions
grid        { 'M': { chest: 22, length: 29, … }, 'L': {…} }   ← inches, numbers
status      'active' | 'retired'
labelPrinted    { 'M': { at, revision }, … }   per size
createdBy/At, updatedBy/At
```

**The grid lives on the pattern document and is edited in place.** A block is
~10 POMs × ~6 sizes = ~60 numbers; the document stays tiny. Measurements are a
**number in inches** — never a string — because tolerance and cm conversion are
arithmetic.

### 4.4 `pom_templates/{id}` — points of measure, editable

```
id       'pant'   label 'Pants & Trousers'
poms: [ { key:'waist_relaxed', label:'Waist (relaxed)',
          howTo:'Lay flat, measure edge to edge across the top of the waistband…',
          photoUrl: null } , … ]
```

Editable in-app (D5). Four seeded: `top`, `pant`, `short`, `jacket`. Per-pattern
`extraPoms` cover "this one has a drawcord length".

**Deleting a POM from a template never deletes recorded data.** A pattern's grid
keeps any key it already holds; the row renders greyed as "no longer in template"
until someone clears it deliberately. A column deletion must never be a data
deletion.

`howTo` is required; `photoUrl` optional via the existing `uploadToCloudinary()`
— a master tracing on craft paper benefits from a picture of where the tape goes.

### 4.5 `patterns/{id}/revisions/{n}` — append-only, and the ONLY thing that notifies

```
n, at, by
reason      'Fit feedback from sample run — hem shortened'
before      { 'M': { length: 29 }, 'L': { length: 30 } }   only the cells that changed
after       { 'M': { length: 28.5 }, 'L': { length: 29.5 } }
noticeId
```

**Editing the grid is free and silent. A revision is an explicit act.** During
initial entry ~8,000 numbers get typed (130 blocks × 10 POMs × 6 sizes); if every
edit notified cutting, Uzaib would be buried. So: "Record a revision" takes a
one-line reason, snapshots the diff between the last revision (or the grid at
first save) and now, and **that** raises the notice with the before/after
attached automatically. This is what "physical correction → change the model too"
means in practice: correct the paper, correct the grid, record the revision, and
cutting sees exactly which cells moved.

Subcollection, `allow update, delete: if false` — like `fabric_movements`.

### 4.6 `pattern_notices/{id}` — the cutting notification

```
patternId, patternCode, revisionN
articleCodes  ['GST060', …]   snapshot at raise time — deliberately NOT derived live
summary, diff
raisedBy, raisedAt
status  'open' | 'acknowledged'    ackBy, ackAt, ackNote
```

Delivered through the **existing bell** (`hrm_notifications`, addressed by
`forUser`), exactly as Marketing M5 does — `js/hrm.js` needs no change.
Deterministic id `ptn_notice_<patternId>_r<n>_<user>` so several devices raise
one. Cutting may update **only** `status/ackBy/ackAt/ackNote` — `hasOnly()` in
rules, the Marketing M3 shape, and the JS field list is asserted equal.

### 4.7 `pattern_slots/{H-S}` — one block per slot, enforced

```
'3-2' → { patternId, since }
```

Written in the **same transaction** as the pattern's `hook`/`slot`, so two people
hanging two blocks on slot 3-2 at once cannot both succeed — the
`creator_handles` lock, reused. Moving a block releases the old lock and takes
the new one atomically. Exactly 50 possible ids.

## 5. The hook map

A 10 × 5 grid, always visible from the hub: each cell shows the pattern code
sitting there (or empty), click to open, drag-free — a block is placed from its
own page by picking hook and slot. **An "Unplaced" strip lists every active
block with no slot**, so the capacity question in §1 is a number on screen.

## 6. Units

Inches are the only stored value. **cm is a view toggle** (per viewer,
`localStorage`, like the snap and minimap preferences in Mood Boards), applied
at render: `in × 2.54`, one decimal. Input is always inches, quarter-inch steps
(`0.25` granularity enforced on save, not on keystroke — the M4 cell lesson:
refusing a keystroke in an input is miserable; flag, then round on save).
Tolerance is **±0.5 in on every POM** (one global constant, Q23); out-of-tolerance is **flagged, never rejected**.

## 7. The label — 5 × 6 inch, one per SIZE in the bundle

Locked (Q24 = A): **each traced sheet in the bundle gets its own sticker**, so a
block with five sizes prints five labels. They share the block's identity and
differ in the size line and the measurement column.

Content, top to bottom: **pattern code** (large) · block name · fit · category ·
**SIZE — this sheet** (large, e.g. `M` or `32`) · "bundle: XS S M L XL" · **hook /
slot** · **articles using it** (codes, wrapped; "+N more" past ~12) · **this
size's measurements** (one column: POM → inches) · a **QR** deep-linking to the
pattern page (`#pattern=<id>`, the Mood Boards `#board=` routing pattern) ·
printed date + revision number.

**The full grid lives on the pattern page; the QR gets you there.**

Printing is **operator-selected** (Q25): from a block, tick the sizes to print
(one, some, all); from the hub, tick the blocks. One PDF, one page per label.
`labelPrintedAt` per size records what was last printed; a size whose
measurements or hook changed since shows "reprint".

### The print-engine touch, stated plainly

`js/print-engine.js` is **hardcoded A4**: `new jsPDF({format:'a4'})` at line
1782, and `PRINT_LAYOUT` (A4 points) is referenced **72 times** by the shared
components — zero of them read `doc.internal.pageSize`. So:

- `printDocument` gains an optional `data.page = {w, h}` in points; the label
  passes `{w:360, h:432}` (5×6 in at 72 pt/in).
- The `pattern-label` variant **draws its own layout** against those bounds. It
  cannot borrow `_renderHeader`/`_renderFooter`/`_renderInfoTable` — they are A4
  by construction. `_stampFooters` is skipped for it.
- Every other variant is untouched. The standing rule ("never call jsPDF directly
  for a new print feature") is kept: the label is still a `printDocument` variant.
- Portrait 5 wide × 6 tall (default — flip to landscape if the sticker stock is
  cut that way).
- `urduLevel: 'none'` — a label is English-only, and skipping the ~10 MB JNN
  fetch matters when printing 100 of them.

## 8. Shopify liveness — server-side rollup

`shopify_products` is per-variant (~1,500 docs). Reading it client-side on each
hub visit is the mistake that exhausted the read quota and blanked the Stock Log.
So `netlify/functions/shopify-catalog-sync.js` (already `0 4 * * *`, 9am PKT,
REST `/products.json`) additionally writes:

```
shopify_articles/{CODE}    ~336 docs
  status ('active'|'draft'|'archived'|'mixed'), productIds[], productTitles[]
  sizesSeen[], sizeAxis, imageUrl, lastSeenAt
```

and adds `imageUrl` (`product.image.src`) to the per-variant write it already
does — the function currently drops the image. `read: if signedIn(); write: if
false;` like every `shopify_*` collection.

## 9. Reconciliation page — prerequisite, not nice-to-have

§2's findings, live and re-runnable, off `articles` + `shopify_articles`:

| Bucket | Action |
|---|---|
| TAC code not on Shopify | mark retired / leave |
| Shopify code not in TAC | **add to registry** (one click — D3) |
| Name mismatch | show both, pick authoritative |
| No SKU on Shopify | show the title-matched candidate, **one click to link** |
| Foreign SKU | flag for a Shopify fix — **we never write to Shopify** |
| Two codes on one product | informational |

The title normaliser is **one function** used by the seed and by this page.

## 10. TAC export

The in-app registry is authoritative (D3). So the .docx becomes an **output**:
"Export TAC list" → PDF (print engine, `generic` A4, per category) and `.xlsx`
(vendored SheetJS). Ammar keeps a document; it can no longer drift from the app.

## 11. PO integration — additive, switched on deliberately

`po.pattern` is a free-text "Pattern number" today (`js/pos.js:604`, printed at
`print-engine.js:1628`). Kept.

- Add `po.patternId`, `po.patternCode`, `po.patternHook` (`'3-2'`), auto-filled
  when the PO's article has a block. Keep writing `po.pattern = patternCode`, so
  the traveler PDF, the job sheet and every old PO render unchanged.
- The traveler's `Pattern # / Name` row gains the hook: `PTN-0042 · Hook 3 / Slot 2`.
- **Go-live is a switch, not a 100% gate.** Coverage = active GROOVY articles
  with `needsPattern:true` that have a `patternId`, shown as a dial on the
  dashboard; an owner flips `settings/pattern_hub.poIntegration = true` when
  satisfied. Otherwise one forgotten baby tee blocks the feature forever.
- Old POs keep their text; no migration.
- Open, unacknowledged notice on the article's pattern → **loud warning** on the
  PO detail and cut plan, **not a block** (the embellishment recipe gate's
  precedent; a hard block is what stops production at 2am for paperwork).

## 12. Round-three answers — all locked (Afnan, 17 Sept)

| Q | Locked |
|---|---|
| 18 Registry vs .docx | **app authoritative, .docx becomes an export** (§10) — Ammar to be told |
| 19 Minting | next-after-highest; gaps are human errors, fillable only by typing an explicit code (§4.1) |
| 20 POM levels | template + per-pattern extras; deleting a POM never deletes data (§4.4) |
| 21 How-to-measure | text required, **photo yes** |
| 22 Revision | explicit "Record a revision"; edits silent (§4.5) |
| 23 Tolerance | **±0.5 in on every POM**, one global value |
| 24 Label | **one label per size in the bundle** (§7) |
| 25 Batch | operator selects one / some / all |
| 26 Go-live | coverage dial + owner switch (§11) |
| 27 Old POs | untouched |
| 28 Master | Hassan and Alam trace; Uzaib manages |
| 29 Uzaib access | view-only from M3, acknowledge from M5 |
| 30 Shopify status | **active + draft** need patterns; archived do not |
| 31 Other brands | **left out of v1** — GROOVY only; registry still seeds all three brands (a brand filter defaults to GROOVY) |

## 13. `firestore.rules`

`isMustafa()`, `isOwner()`, `signedIn()`, `userEmail()` already exist and are
reused — never `isManager()`, which would hand Arfat everything.

```
function isPatternAdmin() { return isOwner() || isMustafa(); }
function isCutting()      { return signedIn() && userEmail() == 'uzaib@groovy.op'; }

match /tac_categories/{p}   { allow read: if signedIn(); allow write: if isPatternAdmin(); }
match /articles/{code}      { allow read: if signedIn(); allow create, update: if isPatternAdmin(); allow delete: if isOwner(); }
match /pom_templates/{id}   { allow read: if signedIn(); allow write: if isPatternAdmin(); }
match /patterns/{id} {
  allow read: if signedIn(); allow create, update: if isPatternAdmin(); allow delete: if isOwner();
  match /revisions/{n} { allow read: if signedIn(); allow create: if isPatternAdmin(); allow update, delete: if false; }
}
match /pattern_slots/{hs}   { allow read: if signedIn(); allow write: if isPatternAdmin(); }
match /pattern_notices/{id} {
  allow read: if signedIn(); allow create: if isPatternAdmin();
  allow update: if (isPatternAdmin() || isCutting())
                && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status','ackBy','ackAt','ackNote']);
  allow delete: if false;
}
match /shopify_articles/{c} { allow read: if signedIn(); allow write: if false; }
match /settings/pattern_hub { allow read: if signedIn(); allow write: if isOwner(); }
```

**This changes `firestore.rules` — republish when built.**

## 14. Milestones

One at a time, each a PR, each verified before the next. `js/patterns.js` is a
new file: script tag in `index.html`, `PRECACHE_URLS` in `sw.js`, bump
`CACHE_VERSION` — the three places.

| # | Milestone | Contents |
|---|---|---|
| **M0** | **Registry + spine** | `tac_categories` + `articles` seeded (3 brands, ~506 codes, `needsPattern` per category). Mint a code; assign a code to an article. Nav gated to `afnan, ammar, mustafa` by username. Loaders cannot reject. |
| **M1** | **Shopify rollup + reconcile** | `shopify_articles` + `imageUrl` in the catalog sync; the reconcile page (§9). **The 27 data fixes from §2 are worked through here, before any pattern exists.** TAC export (§10). |
| **M2** | **Blocks + hook map** | `patterns`, `PTN-####`, create/edit, sizes, `pattern_slots` lock, the 10×5 map, the Unplaced strip. Article→block assignment, bulk-assign from the clustering suggestion, unassigned queue. |
| **M3** | **Measurements** | `pom_templates` (4 seeded, editable, how-to + photo), the grid, inches/cm toggle, tolerance flags. Uzaib gets view access. |
| **M4** | **Label** | `pattern-label` variant with the page-size override, one page per size, operator-selected batch, QR deep link, per-size "reprint" indicator (§7). |
| **M5** | **Revisions + notices** | Record a revision → diff → bell → Uzaib acknowledges. Open-notice list. |
| **M6** | **PO integration** | `po.patternId/Code/Hook`, traveler row, coverage dial, the go-live switch, warn-only banner. |
| **M7** | **Coverage dashboard** | Owner card: assigned / measured / labelled / open notices — the Monitor two-half pattern. |

**Deliberately later:** retiring `PRODUCT_CATALOG` from `js/shared.js` (five
callers, cross-track file — coordinate with Ammar once `articles` is proven);
writing size charts to Shopify (read-only stands); patterns for the other two
brands; a check-out log (D8).

## 15. Tests

`tests/patterns.test.js` plus the existing suites. Each assertion verified by
breaking it before the milestone is done.

- Minting: next-after-highest; a gap is never reused; two concurrent mints of
  the same category yield two different codes; `GCO` produces `-T`/`-B`.
- Title normaliser recovers all 7 denim codes; the 4 new ones return no match.
- Assigning an article writes exactly one document, never the pattern.
- Stale `patternId` is inert. Deleting a template POM leaves grid data intact.
- Slot lock: two blocks cannot take one slot; moving releases the old one.
- Revision diff contains only changed cells; an edit with no revision writes no
  notice; a revision writes exactly one.
- Notice ack-field list == rules `hasOnly` list. `_canManagePatterns()` ==
  `isPatternAdmin()`; Arfat is asserted **out**; Uzaib can ack, not edit.
- cm view is display-only — the stored value never changes on toggle.
- Loaders: allSettled; a failed read and an empty collection render **different**
  screens (`_ptnLoadFailed`).
- `invariants`: script tag + precache entry for `js/patterns.js`; every new
  collection has a rules block; the label's page override never leaks into
  another variant (A4 asserted for `po`, `gate-pass`, `payslip`).
- `smoke-layout`: the measurement grid (10 POMs × 7 sizes is the widest table in
  the app — the shape that crushed the Profile directory to 0px), the hook map at
  420px, the reconcile row, in both themes.

## 16. Open decisions — all Ammar's, all resolved during M1

| # | Decision |
|---|---|
| 1 | Jorts `GJO001`/`GJO002` — which side is right |
| 2 | `GCO` co-ord codes vs their `GHZ`/`GST` twins — which survives |
| 3 | Renamed colourways (`GST062`, `GSO003`, `GB025`) — update TAC to Shopify's names |
| 4 | Mint the four missing codes (three Baby Tees, `The Best Is Yet To Come` v1) |

None block M0. All must land before any pattern is assigned — an article assigned
under a wrong identity is the one expensive mistake here.

## 17. What cannot be verified from a session

- **The sandbox cannot sign in** (`gstatic.com` blocked), so nothing in this
  module can be *looked at* from a session. Logic, geometry and contrast are
  testable; "does the label look right" needs Afnan, a phone, or Claude in
  Chrome — and a **physical print** of the 5×6 label on the actual sticker stock
  before batch-printing 100.
- The Netlify function's Shopify call cannot be exercised here; the first
  scheduled run of the extended catalog sync is the test.
- Cloudinary is unreachable; the how-to-measure photo path is unverifiable here.

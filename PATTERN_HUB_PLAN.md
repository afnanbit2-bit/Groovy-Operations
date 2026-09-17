# Pattern Hub — Master Plan

> Status: **PLANNING ONLY — no code written yet.** This document is the single
> source of truth for the Pattern Hub module. Open decisions are marked
> **[DECISION NEEDED]**. Nothing is built until they are locked.
>
> Requested by Afnan, Sept 2026: *"a pattern hub for all the articles — fetch all
> active articles from Shopify so we can assign a physical pattern to them, take
> their measurements, and notify the cutting stall what to update on them. We
> assign codes to physical patterns from Groovy Ops."*

## 0. The decision that shapes everything

**A pattern is a BLOCK. Many article codes point at one pattern.**

Locked by Afnan, 17 Sept 2026. The alternative — one pattern per article code —
was rejected because the data makes it absurd: `GST060`–`GST073` are fourteen
colourways of one Live In Pants; `GSO001`–`GSO016` are sixteen Aim Shorts. They
are one physical pattern each, not fourteen and sixteen.

Everything downstream follows from this: a measurement set belongs to the block,
a pattern code names the block, and a cutting notice is raised against the block
and fans out to every article using it.

### What "block" means in practice, and why we do not auto-derive it

Clustering the 395 GROOVY article names by style (colourway stripped) yields
**251 candidate blocks**. That number is wrong, and the reason matters:

> **90 of the 103 graphic tees cluster as their own block purely because each has
> a different artwork name.** A graphic tee's name describes its *print*, not its
> *shape*. `GP090`–`GP097` (Effortless Tee) are one body with eight colours;
> most of `GP001`–`GP070` are prints on a small set of blank bodies.

Counting the printed categories — Graphic Tees (103), Tank/Sando (11), Baby Tees
(19) = **133 articles that are print-on-blank** — the realistic block count is
**60–130**, not 251.

**No algorithm can draw that line.** Whether two articles share a physical block
is a fact about paper in a rack, known only to the pattern master. So:

- **Articles are seeded automatically** (from the TAC List, below).
- **Blocks are created by hand.**
- The name-clustering above is offered in the UI as a *suggestion* on the
  unassigned queue — "these 14 look like one block, assign them together?" —
  and is **never applied automatically**.

Same discipline as frame membership and the label library in Mood Boards:
derived and suggested, never stored as truth.

## 1. Verified findings this plan rests on

All figures below were read from the live Shopify Admin API and the TAC List on
16 Sept 2026, not estimated. Method: `productsCount` + seven pages of
`products(first:50, query:"status:active")` paged to `hasNextPage:false`;
cross-matched against `TAC List Complete.docx` (Google Drive, owner Ammar) by
article code and by normalised title.

**Read-only. No Shopify mutation was made or is planned by this module.**

### 1.1 The catalogue

| | count |
|---|---|
| Shopify products — active | **350** |
| Shopify products — all (draft 50, archived 90) | 490 |
| Distinct article codes derivable from active SKUs | **336** |
| GROOVY codes in the TAC List | **395** |
| Codes in `PRODUCT_CATALOG` (`js/shared.js`) | 396 |

**The Shopify SKU *is* the article code plus size** — `GST073-XS`, `GB001-S`,
`GD007-28`. That is the join key, and it already exists. No mapping table needed.

### 1.2 The TAC List is the source of truth; the app has drifted from it

`TAC List Complete.docx` is the authoritative registry across **three brands** —
GROOVY (395 codes), Cultured Legacy (~48), Against All Odds (~63). Only GROOVY is
on this Shopify store.

`PRODUCT_CATALOG` in `js/shared.js` is a **stale partial snapshot** of that
document. 88 active Shopify codes are missing from it — every recent drop
(`GP071`–`GP103`, `GST060`–`GST076`, all 14 `GHW` caps, `GTT005`–`GTT011`,
`GB022`–`GB027`). **The Pattern Hub must not be built on `PRODUCT_CATALOG`.**

### 1.3 Cross-match result (350 active products vs 395 TAC codes)

| | count |
|---|---|
| Clean match — code and name agree | 293 |
| Code matches, **name substantially different** | 12 |
| Code matches, minor spelling drift | 30 |
| Code on Shopify, **absent from TAC** | 5 |
| TAC code **not active** on Shopify | 60 |
| Active products with **no usable SKU** | 11 |

### 1.4 Title matching recovered 7 of the 11 unjoinable products

All denim, all with an empty SKU on Shopify, all with an existing TAC code found
by exact title match:

| Shopify product | Recovered code |
|---|---|
| Carpenter Dark Grey Denim | GD012 |
| Carpenter Light Grey Denim | GD013 |
| Carpenter Washed Black Denim | GD006 |
| Project Rebirth Denim | GD010 |
| cross star denim blue | GD011 |
| CORE Denim \| Washed Blue | GD004 |
| Fade Washed Denim | GD009 |

Each of those codes also appeared in the "in TAC but not active on Shopify" list —
because the product *is* live, its SKU field is simply empty. The two lists
cancel. **These need their existing code typed into Shopify, not a new code.**

**Four genuinely need a new code minted**: `Trying Times`, `Keep Keeping It
Positive`, `Anxiety Prime` (Baby Tees → `GBT###`) and `The Best Is Yet To Come`
(the v1; `GP035` is "…2.0").

### 1.5 Three real errors, confirmed by direct product lookup

1. **The Jorts codes are swapped.** `jorts-dark-stone` carries SKU **GJO001**,
   which TAC defines as *White* Stone; `jorts-white-stone` carries **GJO002**,
   which TAC defines as *Dark* Stone. Two different washes pointing at each
   other's code. **[DECISION NEEDED — Ammar]** which side is authoritative.

2. **`GCO001`–`GCO008` (Co-Ord Sets) are defined in TAC but used nowhere on
   Shopify, and their garments already have other codes.** TAC `GCO001-T` =
   "The Utility Set | Lilac | Top" is the same garment as `GHZ012` = "The Utility
   Top | Lilac". One physical item, two article codes, across all 8 sets.
   For a Pattern Hub this is the worst ambiguity there is.
   **[DECISION NEEDED — Ammar]** retire `GCO`, or retire the `GHZ`/`GST` twins.
   (TAC also mislabels `GCO003-B` and `GCO004-B` as "| Top".)

3. **A colourway was renamed and TAC never caught up.** `GST062` and `GSO003`
   are "Heather Grey" in TAC but ship as **"Arctyc White"** — consistent across
   two categories, so a deliberate rename rather than a mis-keyed code. Same
   shape: `GB025` is "Faded Olive" in TAC, "Muted Olive" on Shopify.

Also, not an error but it kills an assumption: the **Chicago Bulls** product
carries **two** codes, `GP060` (Black) and `GP061` (White) — two colourways
merged into one Shopify product. **One Shopify product ≠ one article.**

### 1.6 Four size axes, and a gap in the existing app

| Axis | Values seen | Examples |
|---|---|---|
| `alpha` | XXXS · XXS · XS · S · M · L · XL | most tops, Live In Pants, VII Cargo |
| `waist` | 26 · 28 · 30 · 32 · 34 | all denim, jorts, Utility V1 cargos |
| `none` | single variant, bare code as SKU | all 14 `GHW` caps |
| (legacy) | foreign schemes | `TOPS-030`, `CARGO-010`, `FOG-02` |

`PO_FLOW_SIZES` in `js/pos.js` is `['XS','S','M','L','XL','2XL']` — it covers
**none** of `XXXS`, `XXS` or numeric waists.

> **Deliberately NOT changed by this module.** `js/pos.js` is shared operational
> code; every PO form, cut-plan row, PDF column and packing reconciliation reads
> that constant. Widening it is a large blast radius for a module that does not
> need it. The Pattern Hub carries its **own** `sizeAxis` per pattern and does
> not touch `PO_FLOW_SIZES`. Logged here as a known gap for a future PO round.

## 2. Actors

| User | Role today | In this module |
|------|-----------|----------------|
| Afnan, Ammar | owner | Full: create/edit patterns, measurements, assign articles, raise notices |
| Mustafa | manager (by username) | Same as owners — matches the Sept 2026 `isMustafa()` grants |
| Arfat | manager | **View only.** He holds the same `manager` role as Mustafa and gets none of the Sept 2026 grants; this follows that precedent exactly |
| **Uzaib** | `viewer`, "Cutting & Fabric" | Sees the hub, sees pattern detail + measurements, **acknowledges cutting notices**, logs pattern check-out/in |
| Hassan, Alam | cutting masters, **no login** | Named on movement records as who physically holds a pattern; they do not sign in |
| Everyone else | — | No nav entry |

## 3. Data model

Six pieces. Firestore, client SDK (window-bridged), same as every module except
`js/store.js`.

### 3.1 `articles/{CODE}` — the spine

Doc id **is** the article code (`GST062`). Seeded from the TAC List.

```
code            'GST062'            (mirrors the doc id)
name            'Live in Pants | Heather Grey'    (TAC name)
brand           'groovy' | 'cultured' | 'against'
category        'GST'               (prefix; label derived in JS)
patternId       'ptn_ab12…' | null  ← THE LINK
active          true                (TAC-level, not Shopify status)
updatedBy/At
```

**The pattern link lives on the ARTICLE, never as an `articles:[…]` array on the
pattern.** This is the `columnId` lesson from Mood Boards, and it applies for the
same reason: assigning an article writes **one** document, so two people
assigning different articles to the same block never collide, and joining a block
never writes the block. "Which articles use this pattern" is a query
(`where('patternId','==',id)`), not stored state.

A **stale `patternId` is inert** — the article renders as unassigned. Nothing is
reconciled on read; no failed write can strand an article inside a deleted block.

### 3.2 `patterns/{id}` — the block

```
code              'PTN-0042'        (minted from counters/pattern)
name              'Live In Pants block'
category          'GST'
fit               'Relaxed'         (free text)
sizeAxis          'alpha' | 'waist' | 'none'
measurementTpl    'top' | 'pant' | 'short' | 'jacket'
currentVersion    3
location          { store, rack, note }
copies            2
status            'active' | 'retired'
createdBy/At, updatedBy/At
```

`copies` exists because a master lives in storage and a working copy sits at
cutting — that was question 6's answer and it is one integer, not a bin-location
system.

### 3.3 `patterns/{id}/versions/{v}` — append-only, and measurements live HERE

```
v              3
changeSummary  'Shortened hem 1/2", widened leg opening 1/4"'
reason         'Fit feedback from sample run'
measurements   { 'M': { chest:{spec:22, tol:0.5}, length:{spec:29, tol:0.5}, … }, … }
changedBy, changedAt
```

**Measurements belong to a VERSION, not to the pattern.** This is the single
choice that makes the cutting-notification feature honest: a revision *is* a new
measurement set, so "what changed" is a diff between two versions rather than a
sentence somebody typed. Without it, "notify cutting what to update" is just a
message board.

A subcollection, not an array, because versions accumulate forever and the
pattern document is rewritten on every edit — the same reasoning as the Mood
Boards Trash. `allow update, delete: if false`, like `fabric_movements` and the
board activity feed.

### 3.4 Measurement templates — a JS constant, not Firestore

`_PTN_TEMPLATES` in `js/patterns.js`. Four templates so nobody fills "inseam" on
a t-shirt:

| Template | Points of measure |
|---|---|
| `top` | chest, length (HPS), shoulder, sleeve length, sleeve opening, armhole, neck width, neck drop, bottom hem |
| `pant` | waist relaxed, waist stretched, hip, thigh, knee, leg opening, front rise, back rise, inseam, outseam |
| `short` | waist relaxed, waist stretched, hip, thigh, leg opening, front rise, back rise, inseam, outseam |
| `jacket` | `top` points + zip length, placket width |

- **Inches, quarter-inch steps, stored as a NUMBER.** Never a free-text string —
  a tolerance check has to be arithmetic.
- **Spec + tolerance, actuals optional.** A measured actual outside
  `spec ± tol` is **flagged, never rejected** — the M4 cell-type lesson: refusing
  a keystroke is miserable, and the person can see what they typed.
- A constant first, migratable to Firestore later if templates need editing
  in-app. Same path `PRINTING_RATE_MASTER` documents.

### 3.5 `pattern_notices/{id}` — the cutting notification

```
patternId, patternCode, version
articleCodes   ['GST060','GST061', …]   snapshot at raise time
summary        (copied from the version's changeSummary)
raisedBy, raisedAt
status         'open' | 'acknowledged'
ackBy, ackAt, ackNote
```

`articleCodes` is a **denormalised snapshot**, deliberately: the notice records
what was affected *when it was raised*, which is what cutting acted on. Deriving
it live would silently rewrite history every time an article is reassigned.

Delivered through the **existing bell** (`hrm_notifications`, addressed by
`forUser`) — exactly how Marketing M5 does it, so `js/hrm.js` needs no change.
Recipients resolved by role/username at raise time, never stored as names.
Deterministic id (`ptn_notice_<patternId>_v<n>_<user>`) so several devices raise
one reminder.

### 3.6 `pattern_movements/{id}` — check-out / check-in

```
patternId, patternCode
action    'out' | 'in'
person    'Hassan'        (free text — cutting masters have no login)
by        uid of whoever logged it
at, note
```

Append-only. This is what makes a missing pattern traceable to a person, which
was question 7's answer.

## 4. Shopify liveness — server-side rollup, not client reads

The hub needs to know, per article code: is it active, draft, archived or absent
from Shopify entirely, and what size axis does it use.

**`shopify_products` is per-VARIANT (~1,500 docs).** Reading all of it
client-side on every hub visit is precisely the mistake that exhausted the
Firestore read quota and made the Stock Log read "0 movements" — see the Store
REST section in `CLAUDE.md`. We do not repeat it.

Instead **extend `netlify/functions/shopify-catalog-sync.js`** (already scheduled
`0 4 * * *`, 9am PKT) to write a second, small collection:

```
shopify_articles/{CODE}          ~336 docs instead of ~1,500
  code, status ('active'|'draft'|'archived'|'mixed')
  productIds[], productTitles[]
  variantCount, sizeAxis ('alpha'|'waist'|'none')
  sizesSeen[]
  imageUrl                       ← see below
  lastSeenAt
```

Rolled up with the Admin SDK where the reads are already being done anyway. The
client reads ~336 small docs, once, lazily, on the hub pages only.

**Also add `imageUrl` to the per-variant write.** `shopify-catalog-sync.js`
currently stores sku/title/color/size/type/tags/status/price and **no image** —
verified by reading the function. A pattern card with no garment photo is much
harder to use, and the field costs one line
(`product.image?.src` from the REST payload).

> `shopify_*` collections are already `read: if signedIn(); write: if false;` —
> only the Admin SDK writes them. `shopify_articles` follows that rule exactly,
> so this needs no new client-write surface.

## 5. Reconciliation — a prerequisite milestone, not a nice-to-have

§1.3–1.5 above is a one-off report produced by hand in a session. It has to
become a live page, or patterns get assigned against bad identities and the mess
is inherited permanently.

`pattern-reconcile` renders, off `articles` + `shopify_articles`:

| Bucket | Action offered |
|---|---|
| Code in TAC, not on Shopify | mark retired, or leave |
| Code on Shopify, not in TAC | add to `articles` (and tell Ammar to add to TAC) |
| **Name mismatch** | show both, pick authoritative |
| **No SKU on Shopify** | show the title-matched TAC candidate, one click to accept |
| Foreign SKU scheme | flag for a Shopify fix |
| Two codes on one product | informational (Chicago Bulls is legitimate) |

**The title matcher is the same normaliser used at seed time** — one definition,
so the reconcile page and the seed can never disagree. (The `_boardsCardText`
lesson.)

**This page never writes to Shopify.** It tells a human what to fix there.

## 6. Rendering rule — a failed read must not look like an empty hub

Per `CLAUDE.md`'s "Loading must never hang": `renderPage` dispatches loaders with
no `.catch`, so **every loader here settles each query independently**
(`Promise.allSettled`), applies whatever succeeded, names what failed, and
renders an error card with Retry rather than an empty state.

`_ptnLoadFailed(col)` mirrors `_storeLoadFailed()`. **A page reading one of these
collections asks it before rendering "no patterns yet".** This is the Store
lesson written down: a read that FAILED and a collection that is EMPTY must never
produce the same screen.

## 7. PO integration — additive, warn-only

`po.pattern` already exists as a free-text "Pattern number" box
(`js/pos.js:604`, printed by `print-engine.js:1628`). This module does **not**
remove it.

- Add `po.patternId` alongside, auto-filled from the PO's article code when that
  article has a block assigned.
- **Keep writing `po.pattern`** as the pattern's `code` string, so the PO
  traveler PDF, the job sheet and every legacy PO keep rendering unchanged.
- On the PO detail and the cut-plan screen, show a **loud warning** — not a block —
  when the article's pattern has an **open, unacknowledged notice**.

> **Warn, not block**, was question 15's default and it stands. The embellishment
> recipe gate already warns rather than blocks, and a hard block on a pattern
> notice is the thing that stops production at 2am for a paperwork reason.
> **[DECISION NEEDED]** only if Afnan wants it to be a block after all.

## 8. `firestore.rules`

New match blocks. `isMustafa()` already exists and is reused rather than widened
to `isManager()` — Arfat holds that role and must not inherit these grants.

```
function isPatternAdmin()  { return isOwner() || isMustafa(); }
function isCutting()       { return signedIn() && userEmail() == 'uzaib@groovy.op'; }

match /articles/{code} {
  allow read:   if signedIn();
  allow create, update: if isPatternAdmin();
  allow delete: if isOwner();
}
match /patterns/{id} {
  allow read:   if signedIn();
  allow create, update: if isPatternAdmin();
  allow delete: if isOwner();

  match /versions/{v} {
    allow read:   if signedIn();
    allow create: if isPatternAdmin();
    allow update, delete: if false;          // append-only
  }
}
match /pattern_notices/{id} {
  allow read:   if signedIn();
  allow create: if isPatternAdmin();
  // cutting may ONLY acknowledge, and only these fields
  allow update: if (isPatternAdmin() || isCutting())
                && request.resource.data.diff(resource.data).affectedKeys()
                     .hasOnly(['status','ackBy','ackAt','ackNote']);
  allow delete: if false;
}
match /pattern_movements/{id} {
  allow read:   if signedIn();
  allow create: if isPatternAdmin() || isCutting();
  allow update, delete: if false;            // append-only
}
match /shopify_articles/{code} {
  allow read:  if signedIn();
  allow write: if false;                     // Admin SDK only
}
```

**This changes `firestore.rules` — it needs a republish.** Per `CLAUDE.md`, the
trigger to ask Afnan is a change to the repo file; check
`git log --oneline -1 -- firestore.rules` against the last recorded republish.

The `hasOnly` field-limiting on the acknowledge path is the Marketing M3 pattern,
and the JS field list and the rules list must be asserted equal in tests.

## 9. Permission helpers

In `js/patterns.js`, mirroring `firestore.rules` exactly:

- `_canViewPatterns()` → owners, managers (incl. Arfat), `uzaib`
- `_canManagePatterns()` → `afnan`, `ammar`, `mustafa` **by username**
- `_canAckPatternNotice()` → `_canManagePatterns()` or `uzaib`

Three layers must agree — the UI (not a boundary), `firestore.rules` (the real
one), and the tests that assert they match. Same shape as
`_profCanEditUser` / `admin-reset-password.js`.

## 10. Milestones

Built and verified **one at a time**, same as the Marketing round and the Mood
Boards table round. Each is a PR.

| # | Milestone | Contents |
|---|---|---|
| **M0** | **Article spine** | `_TAC_ARTICLES` constant (3 brands, ~506 codes) → seed `articles`. `js/patterns.js` created + wired in **three places** (`index.html` script tag, `sw.js` `PRECACHE_URLS`, bump `CACHE_VERSION`). Nav entry, page shell, permission helpers. No pattern concept yet. |
| **M1** | **Shopify rollup + reconcile** | Extend `shopify-catalog-sync.js`: `shopify_articles` rollup + `imageUrl`. `pattern-reconcile` page with the six buckets of §5 and the one-click title-match accept. **This is where the 27 data fixes from §1.3–1.5 get worked through.** |
| **M2** | **Patterns + assignment** | `patterns` collection, `PTN-####` from `counters`, create/edit, location, copies. Article→pattern assignment, including bulk-assign from the clustering suggestion. Unassigned queue. |
| **M3** | **Measurements** | `versions` subcollection, the four templates, per-size spec + tolerance grid, optional actuals with out-of-tolerance flagging. Size axis drives which sizes the grid shows. |
| **M4** | **Versions + cutting notices** | New version = diff against previous = notice raised. Bell delivery via `hrm_notifications`. Uzaib's acknowledge screen. Open-notice list. |
| **M5** | **Check-out / check-in** | `pattern_movements`, who holds what, overdue view. |
| **M6** | **Labels** | `pattern-label` variant on `js/print-engine.js` (**never jsPDF directly** — the standing rule), JsBarcode/QR deep-linking to the pattern page. Reuses the Mood Boards `#board=` deep-link pattern. |
| **M7** | **PO integration** | `po.patternId` additive, `po.pattern` still written, warn-only banner on PO detail and cut plan. |
| **M8** | **Coverage dashboard** | Of N active codes: assigned / measured / open notices. Owner dashboard card, the same two-half placeholder+populate pattern as Monitor and Marketing. |

**Deliberately later, not in v1:**

- Writing size charts back to Shopify (question 12). The app has
  `write_products` scope, but this module stays read-only against Shopify —
  Afnan's instruction, and Inventory Intel's precedent.
- Retiring `PRODUCT_CATALOG` from `js/shared.js`. It has callers in
  `pos.js`, `gatepass.js`, `store.js`, `fabric.js` and `embellishments.js`, and
  `js/shared.js` is a **cross-track file**. Once `articles` is proven, migrate
  those callers one at a time — coordinated with Ammar.
- Headwear patterns (`GHW001`–`GHW014`). Cap construction is not a cut pattern in
  the same sense; they are marked "no pattern required" so they do not sit in the
  unassigned queue forever. Question 5's default.

## 11. Tests

`tests/patterns.test.js`, plus additions to the existing suites. Every assertion
below should be **verified by breaking it** before the milestone is called done —
the standard this repo already holds.

- **Seed + title matcher**: the normaliser recovers all 7 denim codes of §1.4;
  the 4 genuinely-new products return no match rather than a wrong one.
- **Membership on the child**: assigning an article writes exactly ONE document,
  and never the pattern document. (The `columnId` contract.)
- **Stale `patternId` is inert** — renders unassigned, writes nothing on read.
- **Versions are append-only**; measurements never mutate in place.
- **Notice field-limiting**: the JS ack-field list and the `firestore.rules`
  `hasOnly` list are asserted **equal** — the Marketing M3 pattern.
- **Permission parity**: `_canManagePatterns()` and `isPatternAdmin()` name the
  same people; widening either fails. Arfat is asserted **out**.
- **Tolerance maths**: out-of-tolerance flags, never rejects; quarter-inch steps
  round correctly.
- **Loaders cannot reject** — allSettled, partial success renders, total failure
  renders an error card with Retry.
- **`_ptnLoadFailed`**: a failed read and an empty collection produce **different**
  screens.
- `tests/invariants.test.js`: `js/patterns.js` has a script tag in `index.html`
  AND an entry in `sw.js` `PRECACHE_URLS`; every new collection has a
  `firestore.rules` match block.
- `tests/smoke-layout.js`: fragments for the pattern card, the **measurement
  grid** (10 points × 7 sizes is the widest table this app will have — it is
  exactly the shape that crushed the Profile directory's names to 0px) and the
  reconcile row, at 1900/1280/420px in both themes.

## 12. Open decisions

| # | Decision | Owner |
|---|---|---|
| 1 | Jorts `GJO001`/`GJO002` — which side is right? (§1.5) | **Ammar** |
| 2 | `GCO` co-ord codes vs their `GHZ`/`GST` twins — which survives? (§1.5) | **Ammar** |
| 3 | `GST062`/`GSO003`/`GB025` renamed colourways — update TAC to match Shopify? | **Ammar** |
| 4 | Mint 4 new codes for the un-coded Baby Tees / `The Best Is Yet To Come` | **Ammar** |
| 5 | Warn vs hard block on an open notice at cut time (§7) | **Afnan** |
| 6 | Do Cultured Legacy / Against All Odds articles get patterns in v1, or GROOVY only? | **Afnan** |

Decisions 1–4 are Ammar's calls on his own document. They **do not block M0**
(seeding records what TAC says today) but they **must be resolved during M1**,
before any pattern is assigned — an article assigned under a wrong identity is
the one mistake here that is expensive to undo.

## 13. What cannot be verified from a session

Per `CLAUDE.md`'s sandbox limits, stated plainly rather than skipped:

- **The sandbox cannot sign in.** `gstatic.com` is blocked, so `__bootApp()`
  never runs and the app stops at the login screen. **No UI in this module can be
  visually confirmed from a session.** Logic, layout geometry and contrast are
  testable via `tests/smoke-layout.js`; "does this page look right" needs Afnan,
  a phone, or Claude in Chrome.
- `api.shopify.com` is reachable through the MCP connector used for this
  research, but the Netlify functions' own Shopify calls cannot be exercised here.
- Cloudinary is entirely unreachable, so any pattern-photo upload path is
  unverifiable from a session — same as every other image feature in this app.

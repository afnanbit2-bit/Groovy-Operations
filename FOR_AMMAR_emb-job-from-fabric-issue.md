# For Ammar — `js/embellishments.js` changed (21 Sept 2026)

Afnan asked for the Embellishment Department to hear about a job **when
fabric is issued**, carrying the PO, the fabric picked, the article code and
name, and the sizes cut. That touches your file, so here is exactly what
changed and why.

---

## The thing you'll want to know first

**Every auto-created embellishment job on the live site is sized off what was
ORDERED, not what was cut.** That's a pre-existing bug, not something this
round introduced:

```js
// js/pos.js — the caller passed the real cut in
autoCreateEmbJob({...po, cutQty:{...cutState.actualQty}, bundleIds})

// js/embellishments.js — and the payload threw it away
totalQty: po.qty || 0,
sizeBreakdown: po.sizes || {},
```

So a PO ordered 500 and cut 462 produced a printing job that says 500. Fixed
here. **Existing jobs in Firestore are NOT migrated** — they keep their old
numbers. A correction pass over them is a separate job; say the word and I'll
do it as its own reviewable change.

---

## What the chain is now

```
Fabric issued (Uzaib, Fabric Issue screen)
   └─ PO needs embellishment?  no → nothing happens, silently
                               yes ↓
      job exists for this PO?  no → CREATE    yes → TOP UP
      carries: PO · article code + name · fabric(s) · PLANNED cut per size

Cutting done (Uzaib, PO cutting screen)
   └─ the SAME job is updated with the ACTUAL cut per size
```

Two entry points, both into one `_embUpsertJob`:

| | called from | does |
|---|---|---|
| `embOnFabricIssued(po, gp)` | `js/fabric.js` `submitFabricIssue` | create or top up |
| `embOnCuttingDone(po, actualSizes)` | `js/pos.js` `markCuttingDone` | top up (creates if no issue ever did) |

`autoCreateEmbJob` is gone — it became `_embCreateJob`, reached only through
the upsert.

**`js/fabric.js` and `js/pos.js` gained one `typeof`-guarded call each and
nothing else.** All the logic lives in your file. A build without the
embellishments module behaves exactly as it did before.

---

## New fields on a `printing_jobs` record

Everything is **additive** — no existing field changed meaning.

| field | what |
|---|---|
| `plannedSizes` / `plannedTotal` | per-size cut the cut master recorded **at issue** |
| `actualSizes` / `actualTotal` | per-size cut **reported at cutting-done** |
| `fabricIssues[]` | `{gpId, date, cutMaster, unit, qty, items[], rib}` — one per issue |
| `cutMaster` | Hassan / Alam, off the issue |

`items[]` is `{type, gsm, color, unit, qty, rolls[]}` — the issue's own
per-fabric split, so a 2-tone issue keeps both fabrics rather than collapsing
to the primary.

**`totalQty` and `sizeBreakdown` keep their exact meaning** — they're the
display pair: the actual cut once known, else the plan. **All four of your
readers of `sizeBreakdown` needed no change** (`renderJobDetail`, the job
card, the vendor job card, and the detail qty block) because they all iterate
the object's own keys.

### Planned and actual never overwrite each other

Deliberate. A floor that cut 180 against a planned 200 is something your team
needs to see, not a number to quietly replace. If you want that surfaced on
the job card, the two fields are sitting there — I didn't add UI for it
because that's your call on how it should read.

### Not called `cutQty`

`cutQty` on the **PO** document is an object of per-size counts. Reusing that
name for a number on `printing_jobs` would be a collision waiting to bite, so
it's `actualTotal` / `actualSizes`.

---

## Sizes are now whatever was actually cut

A fabric issue records **free-text sizes** — `30`, `32` on denim; `XS`–`2XL`
on tees. The job now stores those labels:

```js
sizeBreakdown: { '30': 80, '32': 120 }     // a denim job
sizeBreakdown: { M: 50, L: 60, XL: 25 }    // a tee job, unchanged
```

I checked before designing anything: **all four readers use
`Object.entries`/`Object.keys`**, so nothing needed touching. The only
XS–2XL-shaped code left is `parseSizeBreakdown`, which serves the **manual**
create form's `"10:20:30"` positional string — correct as-is.

**Known limit, worth knowing rather than discovering:** `markCuttingDone` is
driven by `PO_FLOW_SIZES`, which is alpha-only. So a denim job carries waist
sizes in its PLAN and alpha sizes in its ACTUAL, and since the display prefers
actual, **a waist-sized PO shows waist until cutting-done and alpha after
it.** Widening `PO_FLOW_SIZES` is the real fix and it's a cross-track change —
flagging it rather than doing it unilaterally.

---

## Two behaviour changes that affect your track

**1. The PP-sample SLA clock starts earlier.** `addSLAEvent(… 'pp_sample' …)`
fires on job creation, which is now the fabric issue rather than cutting
completion. Asghar's PP deadline therefore starts by however long cutting
takes. I think that's right — printing should be preparing while cutting runs,
which is the whole point of hearing about it earlier — but **your SLA numbers
will shift and that's your area, so overrule me if it's wrong.**

**2. One job per PO, and a second fabric issue adds to it.** Matches what the
old dedupe already did (`allPrintingJobs.find(j=>j.poNumber===po.id)`). A PO
issued fabric twice — second colour, top-up run — is one job whose planned
quantity adds up. The same gate pass arriving twice is deduped on `gpId`, so a
retry can't double the plan.

---

## Tests

- **`tests/embellishment-jobs.test.js`** — 43 assertions, new. It **drives the
  real entry points**, not the helpers. Verified by reverting each piece:
  restoring `po.qty`/`po.sizes` fails 3 by name, overwriting the plan fails 2,
  dropping the gate-pass dedupe fails 4, making a second issue mint a second
  job fails 4, removing the embellishment gate fails 2.
- **`tests/invariants.test.js`** — holds the two call sites, since the suite
  above proves what the entry points do and nothing about whether anyone calls
  them. Verified by deleting the `fabric.js` site (4 fail) and the `pos.js`
  guard (1).
- Full suite: **3974/3974**. `smoke-browser`: 7/7.

**Nobody has issued fabric on a real screen** — the sandbox can't sign in, so
none of this has been seen in a browser. First real fabric issue on a PO with
embellishment is the test.

---

## If you want it different

The parts I'd expect you to have an opinion on:

- the SLA clock starting at issue rather than at cutting
- whether planned-vs-actual should show on the job card, and how
- whether a second fabric issue should really be one job or two
- whether a non-embellishment PO should leave any trace at all

All four are small changes from here.

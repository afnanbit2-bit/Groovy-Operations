# Permissions & Accounts — Master Plan

> Status: **PLANNED, NOTHING BUILT.** Design agreed in two question rounds
> with Afnan (21 Sept 2026). This document is the single source of truth for
> the module; read it before touching any permission gate.
>
> Origin: a colleague's pitch — *"we already have active user profiles; what
> if I have a module where you can grant access to a profile and give them
> rights as well — this way you can customise who can have what module."*

## 0. Decisions taken (do not re-litigate without Afnan)

| Question | Decision |
|---|---|
| Roles vs individual rights | **Role presets + per-person overrides.** A role expands to a default capability set; individual grants layer on top. |
| Accounts too, or rights only? | **Accounts too** — create, disable and offboard from the UI. `USER_DEFS` is retired as the account list. |
| Who may grant | **Owners only** (afnan, ammar). Not Mustafa, though he is a profile admin — granting rights is the one screen that can escalate privilege. |
| Page access as a capability | **Later phase.** Ship the capability system first; convert `buildNav`/`showPage` once it is proven. |
| Login identity | **Email.** Username login needed a username→email lookup before sign-in, which a Firestore account list cannot serve. |
| Offboarding | **Disable the Auth account, keep every record.** Instant lockout; profile, history and authorship stay intact and attributed. |
| Revocation speed | **Disable the account for urgent cases; accept token staleness otherwise.** No per-request revocation check. |
| First delivery | **The invisible parity refactor**, alone, green, before anything else. |

## 1. What is there today (measured 21 Sept 2026, not recalled)

| | count |
|---|---|
| Accounts in `USER_DEFS` (`js/auth.js` — a **public** asset) | 15 |
| Permission helper functions across `js/*.js` | **37** |
| Inline `session.u==='x'` / hardcoded name-list sites | **58** |
| Named username-list constants | 8 |
| **Identity gates in `firestore.rules`** | **10** |
| `match /` blocks in the rules | 81 |
| `renderPage` dispatch branches | 66 |
| Roles | 9 |

Permissions are **four incompatible shapes at once**: a role string, per-account
booleans on `USER_DEFS` (`canPO`, `canFabric`, `canApprovePaidPR`,
`canEditScoring`), a `stages` array, and 58 hardcoded username checks.
`session` is built client-side at login by looking the username up in
`USER_DEFS`.

## 2. THE SPLIT THAT DECIDES EVERYTHING

**37 helpers, but only 10 identity gates in `firestore.rules`.** So ~27 of the
37 were never security — they are nav and UI gates, exactly as CLAUDE.md says
of the Creative Hub ("this is a **nav-only** gate"). Therefore:

> Capabilities divide into **BOUNDARY** (the rules enforce it) and **NAV** (the
> UI decides). **Do not try to make all 41 hard.** Making 81 `match` blocks
> consult a permission document adds a read to every request, in an app that
> has already had a read-quota outage (see CLAUDE.md, "the answer was HTTP 429").

**The UI must SAY which is which.** A matrix where un-ticking a box *looks*
like it protects data but does not is worse than no module — it manufactures
false confidence. Boundary capabilities must read differently on screen from
nav ones.

## 3. Architecture

**Runtime truth = Firebase Auth custom claims.** Set by a Netlify function
through the Admin SDK; read by `firestore.rules` as `request.auth.token.*`
with **zero extra document reads** — the rules already read
`request.auth.token.email`. Claims are part of the signed token and cannot be
forged client-side.

**`session` is built from the TOKEN, not from a Firestore read.**
`getIdTokenResult()` returns the claims immediately after sign-in. That means:
no blocking read on the path to the first render (the white-screen incident —
CLAUDE.md "Diagnostics"), it works offline, and **the UI and the rules cannot
disagree, because they read the same token.**

**Editor model = `user_accounts/{uid}` in Firestore.** `allow read: if
signedIn(); allow write: if false` — written ONLY by the server function. If a
client could write it, the module becomes a self-serve escalation button. This
doc is what the admin screen renders and edits; the function derives the claims
from it. Doc = intent, claims = enforcement.

### The claim payload is MEASURED, not estimated

41 capabilities, as a readable JSON array beside role and username:

```
full set as JSON array  :  554 bytes
documented limit        : 1000 bytes   [UNVERIFIED — see §7]
headroom                :  446 bytes  ≈ 40 more capabilities
```

**Readable capability strings, NOT a bitfield.** A hex bitfield is 53 bytes
and saves 500 nobody needs — and the day somebody reorders the registry every
account silently gets different rights. That is precisely the bug class this
codebase keeps recording. The array fits; use the array.

## 4. The 41 capabilities

Derived from the 37 existing helpers plus the two the module itself needs.
**Bold = BOUNDARY** (must be mirrored in `firestore.rules`).

- **`acct.manage`**, **`perm.grant`** — the module's own gates, owners only
- `po.create` `po.edit` · `fabric.view` `fabric.edit` **`fabric.delete`**
- **`pay.view`** **`pay.run`** **`pay.slip`** · `hrm.ops` **`hrm.approve`** **`hrm.loans`** `hrm.policy`
- `store.approve` · `cash.view` `cash.entry` `cash.admin`
- `recipe.manage` `recipe.lock` · `pp.new` `pp.repeat` `pp.urgent` `bill.approve`
- `qc.record` `qc.view` · `print.work` `bundle.work` `stitch.work` `wash.work`
- `ptn.view` **`ptn.manage`** `ptn.ack`
- **`mkt.access`** **`mkt.lead`** **`mkt.paidpr`** **`mkt.scoring`**
- `hub.view` `intel.view` `fulfil.view` `monitor.view`

## 5. Phases — each shippable and reversible alone

**Phase 1 — the parity refactor. Zero behaviour change.**
Route all 37 helpers and 58 inline sites through one `can('pay.view')`,
backed *initially by exactly today's hardcoded lists*.

> **The safety net, and it is the most valuable test in the project.**
> Enumerate every account × every capability — 15 × 41 = **615 answers** —
> snapshot the table, and assert it is byte-identical after the refactor. If
> one flips, the test names it (`asghar / pay.view: was false, now true`).
> Without it, a 95-site hand edit is trust; with it, it is proof.

**Phase 2 — the data.** `user_accounts/{uid}`; `can()` prefers a stored grant,
falls back to the Phase-1 default. No rules change, no UI.

**Phase 3 — the screen.** Permissions tab on the profile, owners only, with
the boundary/nav distinction visible.

**Phase 4 — the boundary.** Claims + the ~10 rules mirrors. **The only phase
needing a Console republish.**

**Phase 5 — accounts.** Create / disable / offboard; email login; retire
`USER_DEFS` to identity only.

**Phase 6 — page access** as a capability; unpick `buildNav`'s per-role
branches and `showPage`'s id rewriting.

## 6. Traps specific to THIS app

1. **`startApp` must not `await` permissions.** That exact shape caused the
   white-screen incident. Claims-in-token is what avoids it — see §3.
2. **RETIRE the hardcoded lists, never sit beside them.** A third source of
   truth disagreeing with the other two is strictly worse than today.
3. **Self-escalation.** An owner-only gate is not enough on its own: the
   server function must also refuse to grant a capability the caller does not
   hold, and must honour `_PROFILE_PROTECTED` (Mustafa may not edit an owner).
4. **Lockout.** Server-side floor: there must always be ≥1 account holding
   `perm.grant`, and this UI can never remove the last one.
5. **The republish problem.** CLAUDE.md records **four** incidents of rules not
   being republished and features silently breaking. Every boundary capability
   added later is a manual Console step — another reason that set stays small
   and stable.
6. **`tests/invariants.test.js` already asserts** the JS lists and the rules
   lists name the same people (Paid PR approvers, scoring admin, pattern
   admins, profile admins). That property must be kept or replaced with
   something stronger, not dropped.
7. **Audit.** Every grant and revoke through `logActivity`, and added to
   Monitor's `_MONITOR_WATCH_ACTIONS` — permission changes are exactly what
   that panel exists for.
8. **Email login is a habit change for 15 people**, and the login screen's
   "Username not found" copy, the remembered-user key and the error states all
   assume usernames. Plan the switch, don't discover it.

## 7. UNVERIFIED — confirm before building

- **Custom claims size limit (~1000 bytes)** and **rules `get()` limit (~10 per
  request)** are recalled from Firebase documentation. `firebase.google.com` is
  **blocked from the build sandbox** (`HTTP 000`, tested 21 Sept 2026), so
  neither could be checked from a session. The 554-byte payload leaves enough
  headroom that a smaller real limit is unlikely to bite, but **confirm the
  claims limit before Phase 4.**
- Whether claim propagation on this Firebase project behaves as documented
  (staleness up to token refresh) — the first real grant is the test.
- **Nothing in this module has been built or looked at in a browser.**

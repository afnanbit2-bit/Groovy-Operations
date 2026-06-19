# Groovy Operations — Data Safety, Backups & Recovery

This document records how Groovy Operations data is protected and **how to
recover it** if something goes wrong (a bug, a bad write, an accidental
delete). Keep it up to date if any of the settings below change.

> **Project:** `groovy-gatepass` (Firebase / Google Cloud)
> **Set up:** 19 June 2026
> **Owners:** Afnan, Ammar

---

## 1. Where the data lives

| Data | Store | Backed up by the settings below? |
|---|---|---|
| Fabric (`fabricin`, `fabric_inventory`, `fabric_movements`) | Cloud Firestore | ✅ Yes |
| POs, bundles, gate passes, returns | Cloud Firestore | ✅ Yes |
| Store, embellishments, HRM, payroll | Cloud Firestore | ✅ Yes |
| Activity log, notifications, bug reports | Cloud Firestore | ✅ Yes |
| Shopify intelligence (`shopify_*`) | Cloud Firestore | ✅ Yes (also re-syncable from Shopify) |
| **Attendance** (`attendance/*`) | **Realtime Database** | ❌ Not covered here — see §5 |

Firestore is automatically replicated by Google across multiple data centres,
so hardware failure is **not** a data-loss risk. The protections below exist
for the realistic risks: **bad code/bugs, accidental deletes, and human error.**

---

## 2. What is enabled (as of 19 June 2026)

Managed in the Firebase Console →
**Firestore → Disaster recovery** tab
(`https://console.firebase.google.com/project/groovy-gatepass/firestore/databases/-default-/disasterrecovery`).

### Point-in-Time Recovery (PITR) — ✅ ENABLED
- **Retention: 7 days.** You can read/restore the database as it existed at
  **any minute within the last 7 days.**
- This is the primary protection against "a bug deleted/overwrote data."
  You can selectively write the recovered data back — it does not force a
  full-database overwrite.

### Scheduled backups — ✅ ENABLED
- **Daily backups, 98-day retention** (≈14 weeks).
- Each backup can be **restored into a new database**, which you then
  inspect and copy from. Restores never overwrite the live database.

### Cost
Both features bill only for backup storage — negligible at Groovy's data size
(a few cents/month). Requires the project to stay on the **Blaze** plan.

---

## 3. Access control (defense against bad writes/deletes)

Security is enforced by `firestore.rules` (in this repo — the canonical copy).
**The repo file must be published to the Firebase Console to take effect:**
`https://console.firebase.google.com/project/groovy-gatepass/firestore/rules`
→ paste the contents of `firestore.rules` → **Publish**.

Key fabric protection (added 19 June 2026):

- **Fabric records cannot be deleted by worker/store/viewer accounts.**
  `delete` on `fabricin`, `fabric_inventory`, and `fabric_movements` is
  restricted to **owners + managers** (`isOM()`), matching the app's
  approval flow. Reads, additions, and updates remain open to any signed-in
  user (workers still need to add receipts, run QC, and issue/return fabric).
- Workers who need a fabric entry removed use the **in-app delete request**,
  which routes to an owner/manager for approval.

---

## 4. How to recover data

You will only need these if something goes wrong. Run from a machine with the
[`gcloud` CLI](https://cloud.google.com/sdk/docs/install) authenticated to the
`groovy-gatepass` project (`gcloud config set project groovy-gatepass`).

### A) Recover from Point-in-Time Recovery (within the last 7 days)
Export the database as it was at a chosen past moment to a Storage bucket:

```bash
# Pick a timestamp BEFORE the bad change (UTC, whole minute, within 7 days)
gcloud firestore export gs://groovy-gatepass.appspot.com/recover-2026-06-18 \
  --snapshot-time=2026-06-18T22:00:00Z
```

Then import only what you need into the live database (or a scratch database
first to verify), e.g. a single collection:

```bash
gcloud firestore import gs://groovy-gatepass.appspot.com/recover-2026-06-18 \
  --collection-ids=fabricin,fabric_inventory,fabric_movements
```

> Tip: import into a **separate** database first, confirm the data is right,
> then copy the specific documents back. Importing overwrites documents with
> the same IDs.

### B) Recover from a scheduled (daily) backup
List available backups, then restore one into a NEW database:

```bash
gcloud firestore backups list --location=<your-region>

gcloud firestore databases restore \
  --source-backup=projects/groovy-gatepass/locations/<region>/backups/<BACKUP_ID> \
  --destination-database=groovy-recovered
```

Open `groovy-recovered` in the console, find the good data, and copy what you
need back into `(default)`.

### C) Quick visual check (no restore)
The Firestore **Disaster recovery** tab → **View all backups** lists every
snapshot. PITR's "Earliest version time" shows how far back you can currently
rewind.

---

## 5. Not covered: Attendance (Realtime Database)

Attendance lives in the **Realtime Database** (`attendance/{date}` and
`attendance/live`), which PITR and Firestore scheduled backups do **not**
cover. It is low-risk because it is re-generated daily from the ZKTeco device
(`attendance-sync/`). If you want it backed up too:

- Firebase Console → **Realtime Database → ⋮ → Export JSON** for a manual
  snapshot, or
- Ask Claude to add an automated RTDB export (a scheduled Netlify Function).

---

## 6. Optional next layer (not yet built)

A **nightly JSON export to Firebase Storage** — owner-controlled, downloadable
copies of every collection, independent of Google's backup system. Not yet
implemented; ask Claude to add `netlify/functions/firestore-backup.js` if you
want this extra layer.

---

## Checklist if you ever suspect data loss

1. **Don't panic and don't bulk-edit** — the old data is still recoverable.
2. Note the **approximate time** the problem started.
3. Use **§4A (PITR)** to export from just before that time.
4. Verify in a scratch database, then copy back only the affected documents.
5. If it's older than 7 days, use **§4B (scheduled backup)** instead.

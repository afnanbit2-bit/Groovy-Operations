const admin = require("firebase-admin");

const SHOPIFY_API_VERSION = "2026-04";

// ── Firebase Admin ──────────────────────────────────────────────
let _db;
function getDb() {
  if (!_db) {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    if (!admin.apps.length) {
      admin.initializeApp({ credential: admin.credential.cert(sa) });
    }
    _db = admin.firestore();
  }
  return _db;
}

async function getShopifyToken() {
  const res = await fetch(
    `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/oauth/access_token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.SHOPIFY_CLIENT_ID,
        client_secret: process.env.SHOPIFY_CLIENT_SECRET,
        grant_type: "client_credentials",
      }),
    }
  );
  const data = await res.json();
  if (!data.access_token) {
    throw new Error(`Token exchange failed: ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

function parseNextUrl(linkHeader) {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const m = part.match(/<([^>]+)>;\s*rel="next"/);
    if (m) return m[1];
  }
  return null;
}

// ── Retry / completeness helpers ────────────────────────────────
// A truncated snapshot must never be written as a success (it used to be:
// HTTP 429 broke the paging loop and the partial result was saved).
const TIME_BUDGET_MS = 24000; // total time we allow ourselves for paging+retries
const MAX_ATTEMPTS = 5;       // per page
let _sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function retryDelayMs(res, attempt) {
  const ra = res.headers && res.headers.get ? res.headers.get("retry-after") : null;
  const secs = ra != null && ra !== "" ? Number(ra) : NaN;
  if (Number.isFinite(secs) && secs >= 0) return Math.ceil(secs * 1000);
  return Math.min(1000 * Math.pow(2, attempt), 8000);
}

// Fetch one page; retry 429 / 5xx honouring Retry-After inside the budget.
// Returns the ok Response, or throws Error with .code='INCOMPLETE_PAGING'.
async function fetchPage(url, token, deadline) {
  let last = "";
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const res = await fetch(url, { headers: { "X-Shopify-Access-Token": token } });
    if (res.ok) return res;
    const text = await res.text();
    last = `${res.status}: ${String(text).slice(0, 300)}`;
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable) throw new Error(`Inventory levels ${last}`);
    const wait = retryDelayMs(res, attempt);
    if (attempt === MAX_ATTEMPTS - 1 || Date.now() + wait > deadline) break;
    await _sleep(wait);
  }
  const e = new Error(`Inventory paging incomplete - gave up after retries (last ${last})`);
  e.code = "INCOMPLETE_PAGING";
  throw e;
}

// Only a complete snapshot is ever written, so a replacement is always
// complete; a complete existing doc is replaced only by another complete one.
// A legacy doc (no `complete` field) may be replaced by a complete one.
function canReplaceSnapshot(existing, newIsComplete) {
  if (!newIsComplete) return false;
  return true;
}

function pktDateStr() {
  const d = new Date(Date.now() + 5 * 3600000);
  return d.toISOString().split("T")[0];
}

// ── Handler ─────────────────────────────────────────────────────
exports.handler = async function () {
  const start = Date.now();
  const elapsed = () => Date.now() - start;

  const required = [
    "SHOPIFY_CLIENT_ID",
    "SHOPIFY_CLIENT_SECRET",
    "SHOPIFY_STORE_DOMAIN",
    "FIREBASE_SERVICE_ACCOUNT",
  ];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Missing env vars: ${missing.join(", ")}` }),
    };
  }

  const db = getDb();
  const syncRef = db.collection("shopify_sync_meta").doc("inventory_sync");
  const dateKey = pktDateStr();

  try {
    const token = await getShopifyToken();
    const store = process.env.SHOPIFY_STORE_DOMAIN;

    // ── Get all locations (stock is summed across every one) ────
    const locRes = await fetch(
      `https://${store}/admin/api/${SHOPIFY_API_VERSION}/locations.json`,
      { headers: { "X-Shopify-Access-Token": token } }
    );
    if (!locRes.ok) throw new Error(`Locations ${locRes.status}`);
    const locData = await locRes.json();
    const locations = locData.locations || [];
    if (!locations.length) throw new Error("No Shopify locations found");
    // Owner decision (Sept 2026): stock is SUMMED ACROSS ALL locations. Before
    // this only the first was read, so a multi-location store was understated.
    const locationIds = locations.map((l) => String(l.id));
    const locationId = locations[0].id; // kept for old readers: the first location
    const locationsSeen = locationIds.length;
    const deadline = start + TIME_BUDGET_MS;

    // ── Load shopify_products for cross-reference ───────────────
    const prodSnap = await db
      .collection("shopify_products")
      .select("sku", "inventory_item_id")
      .get();
    const invToVariant = new Map();
    prodSnap.forEach((doc) => {
      const d = doc.data();
      if (d.inventory_item_id) {
        invToVariant.set(String(d.inventory_item_id), {
          variant_id: doc.id,
          sku: d.sku || "",
        });
      }
    });

    // ── Paginate inventory levels ───────────────────────────────
    // location_ids takes at most 50 ids, so ask in chunks of 50 (one chunk for
    // any normal store). One inventory item has one level per location; the
    // item's stock is the SUM of its levels. A chunk that fails to finish
    // throws, so a partial sum is never written.
    const items = {};
    let totalAvailable = 0;
    let levelRows = 0; // item x location rows read
    let pages = 0;

    for (let i = 0; i < locationIds.length; i += 50) {
      const chunk = locationIds.slice(i, i + 50).join(",");
      let url = `https://${store}/admin/api/${SHOPIFY_API_VERSION}/inventory_levels.json?location_ids=${chunk}&limit=250`;
      while (url) {
        const res = await fetchPage(url, token, deadline);
        pages++;
        const body = await res.json();

        for (const lv of body.inventory_levels || []) {
          const invId = String(lv.inventory_item_id);
          const available = lv.available ?? 0;
          const ref = invToVariant.get(invId);

          if (!items[invId]) {
            items[invId] = {
              available: 0,
              variant_id: ref ? ref.variant_id : null,
              sku: ref ? ref.sku : "",
            };
          }
          items[invId].available += available;
          totalAvailable += available;
          levelRows++;
        }

        url = parseNextUrl(res.headers.get("link"));
      }
    }
    const levelCount = Object.keys(items).length; // distinct inventory items

    // ── Write snapshot doc ──────────────────────────────────────
    const now = admin.firestore.FieldValue.serverTimestamp();
    const snapRef = db.collection("shopify_inventory_snapshots").doc(dateKey);
    const existingSnap = await snapRef.get();
    const existing = existingSnap && existingSnap.exists ? existingSnap.data() : null;
    if (!canReplaceSnapshot(existing, true)) {
      throw new Error("Refusing to overwrite snapshot");
    }
    await snapRef.set({
      date: dateKey,
      snapshot_at: now,
      location_id: locationId,
      location_ids: locationIds,
      locations_seen: locationsSeen,
      total_available: totalAvailable,
      variant_count: levelCount,
      items,
      complete: true,
      pages,
      item_count: levelCount,
      level_rows: levelRows,
    });

    // ── Update sync meta ────────────────────────────────────────
    const summary = {
      last_run_at: now,
      last_success_at: now,
      last_status: "success",
      last_error: null,
      last_error_reason: null,
      last_warning: null,
      locations_seen: locationsSeen,
      pages,
      last_date: dateKey,
      location_id: locationId,
      location_ids: locationIds,
      levels_captured: levelCount,
      total_available: totalAvailable,
      duration_ms: elapsed(),
    };
    await syncRef.set(summary, { merge: true });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(summary),
    };
  } catch (err) {
    try {
      await syncRef.set(
        {
          last_run_at: admin.firestore.FieldValue.serverTimestamp(),
          last_status: "error",
          last_error: err.message,
          last_error_reason: err.code || "error",
        },
        { merge: true }
      );
    } catch (_) {}

    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message, duration_ms: elapsed() }),
    };
  }
};

exports._test = {
  retryDelayMs,
  canReplaceSnapshot,
  setSleep(fn) { _sleep = fn; },
};

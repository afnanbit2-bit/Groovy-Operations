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

    // ── Get primary location ────────────────────────────────────
    const locRes = await fetch(
      `https://${store}/admin/api/${SHOPIFY_API_VERSION}/locations.json`,
      { headers: { "X-Shopify-Access-Token": token } }
    );
    if (!locRes.ok) throw new Error(`Locations ${locRes.status}`);
    const locData = await locRes.json();
    const locations = locData.locations || [];
    if (!locations.length) throw new Error("No Shopify locations found");
    const locationId = locations[0].id;

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
    let url = `https://${store}/admin/api/${SHOPIFY_API_VERSION}/inventory_levels.json?location_ids=${locationId}&limit=250`;
    const items = {};
    let totalAvailable = 0;
    let levelCount = 0;

    while (url) {
      const res = await fetch(url, {
        headers: { "X-Shopify-Access-Token": token },
      });
      if (!res.ok) {
        const text = await res.text();
        if (res.status === 429) break;
        throw new Error(`Inventory levels ${res.status}: ${text.slice(0, 300)}`);
      }
      const body = await res.json();

      for (const lv of body.inventory_levels || []) {
        const invId = String(lv.inventory_item_id);
        const available = lv.available ?? 0;
        const ref = invToVariant.get(invId);

        items[invId] = {
          available,
          variant_id: ref ? ref.variant_id : null,
          sku: ref ? ref.sku : "",
        };
        totalAvailable += available;
        levelCount++;
      }

      url = parseNextUrl(res.headers.get("link"));
    }

    // ── Write snapshot doc ──────────────────────────────────────
    const now = admin.firestore.FieldValue.serverTimestamp();
    await db
      .collection("shopify_inventory_snapshots")
      .doc(dateKey)
      .set({
        date: dateKey,
        snapshot_at: now,
        location_id: locationId,
        total_available: totalAvailable,
        variant_count: levelCount,
        items,
      });

    // ── Update sync meta ────────────────────────────────────────
    const summary = {
      last_run_at: now,
      last_success_at: now,
      last_status: "success",
      last_error: null,
      last_date: dateKey,
      location_id: locationId,
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

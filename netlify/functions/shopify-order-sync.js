const admin = require("firebase-admin");

const SHOPIFY_API_VERSION = "2026-04";
const PAGE_SIZE = 50;
const LOOKBACK_HOURS = 48;
const DEADLINE_MS = 9000;
const PAGE_RESERVE_MS = 3000;

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
  const syncRef = db.collection("shopify_sync_meta").doc("order_sync");

  try {
    const token = await getShopifyToken();
    const store = process.env.SHOPIFY_STORE_DOMAIN;
    const now = admin.firestore.FieldValue.serverTimestamp();

    // ── Load product map for denormalization ─────────────────────
    const prodSnap = await db
      .collection("shopify_products")
      .select("sku", "product_title", "color", "size", "product_type")
      .get();
    const productMap = new Map();
    prodSnap.forEach((doc) => productMap.set(doc.id, doc.data()));

    // ── Build start URL: orders from last 48h ───────────────────
    const since = new Date(Date.now() - LOOKBACK_HOURS * 3600000);
    let url = `https://${store}/admin/api/${SHOPIFY_API_VERSION}/orders.json?limit=${PAGE_SIZE}&status=any&created_at_min=${since.toISOString()}`;

    let ordersProcessed = 0;
    let lineItemsWritten = 0;
    let skippedOrders = 0;
    let pagesThisRun = 0;

    while (url) {
      if (elapsed() > DEADLINE_MS - PAGE_RESERVE_MS) break;

      const res = await fetch(url, {
        headers: { "X-Shopify-Access-Token": token },
      });

      if (!res.ok) {
        const text = await res.text();
        if (res.status === 429) break;
        throw new Error(`Shopify ${res.status}: ${text.slice(0, 300)}`);
      }

      const body = await res.json();
      const orders = body.orders || [];

      // ── Skip existing orders ──────────────────────────────────
      let existingIds = new Set();
      if (orders.length) {
        const refs = orders.map((o) =>
          db.collection("shopify_orders").doc(String(o.id))
        );
        const snaps = await db.getAll(...refs);
        snaps.forEach((s) => {
          if (s.exists) existingIds.add(s.id);
        });
      }

      const newOrders = orders.filter(
        (o) => !existingIds.has(String(o.id))
      );
      skippedOrders += orders.length - newOrders.length;

      if (newOrders.length > 0) {
        const writer = db.bulkWriter();

        for (const order of newOrders) {
          writer.set(
            db.collection("shopify_orders").doc(String(order.id)),
            {
              order_number: order.order_number,
              created_at: order.created_at,
              currency: order.currency,
              total_price: parseFloat(order.total_price) || 0,
              financial_status: order.financial_status || "",
              fulfillment_status: order.fulfillment_status || null,
              cancelled_at: order.cancelled_at || null,
              line_item_count: (order.line_items || []).length,
              synced_at: now,
            }
          );

          for (const li of order.line_items || []) {
            const product = productMap.get(String(li.variant_id));

            writer.set(
              db
                .collection("shopify_line_items")
                .doc(`${order.id}_${li.id}`),
              {
                order_id: order.id,
                line_item_id: li.id,
                sku: (product && product.sku) || li.sku || "",
                product_title:
                  (product && product.product_title) || li.title || "",
                color: (product && product.color) || "",
                size: (product && product.size) || "",
                product_type: (product && product.product_type) || "",
                quantity: li.quantity || 0,
                price: parseFloat(li.price) || 0,
                order_created_at: order.created_at,
                financial_status: order.financial_status || "",
                synced_at: now,
              }
            );
            lineItemsWritten++;
          }

          ordersProcessed++;
        }

        await writer.close();
      }

      url = parseNextUrl(res.headers.get("link"));
      pagesThisRun++;
    }

    const summary = {
      last_run_at: now,
      last_success_at: now,
      last_status: "success",
      last_error: null,
      orders_processed: ordersProcessed,
      line_items_written: lineItemsWritten,
      skipped_orders: skippedOrders,
      pages_this_run: pagesThisRun,
      lookback_hours: LOOKBACK_HOURS,
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

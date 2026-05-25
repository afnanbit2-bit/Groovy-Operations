const admin = require("firebase-admin");

const SHOPIFY_API_VERSION = "2026-04";
const BACKFILL_DAYS = 90;
const PAGE_SIZE = 50;
const DEADLINE_MS = 9000;
const PAGE_RESERVE_MS = 3000;

// ── Firebase Admin (cached across warm invocations) ─────────────
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

// ── Shopify auth (Client Credentials Grant) ─────────────────────
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

// ── Cursor-based pagination via Link header ─────────────────────
function parseNextUrl(linkHeader) {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const m = part.match(/<([^>]+)>;\s*rel="next"/);
    if (m) return m[1];
  }
  return null;
}

// ── Load shopify_products for denormalization ───────────────────
async function loadProductMap(db) {
  const snap = await db
    .collection("shopify_products")
    .select("sku", "product_title", "color", "size", "product_type")
    .get();
  const map = new Map();
  snap.forEach((doc) => map.set(doc.id, doc.data()));
  return map;
}

// ── Handler ─────────────────────────────────────────────────────
exports.handler = async function () {
  const start = Date.now();
  const elapsed = () => Date.now() - start;
  const timings = {};

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
  const syncRef = db.collection("shopify_sync_meta").doc("order_backfill");

  try {
    const syncSnap = await syncRef.get();
    const state = syncSnap.exists ? syncSnap.data() : {};
    timings.sync_read_ms = elapsed();

    if (state.complete) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message:
            "Backfill already complete. Delete shopify_sync_meta/order_backfill to re-run.",
          orders_processed: state.orders_processed,
          line_items_written: state.line_items_written,
          complete: true,
        }),
      };
    }

    const token = await getShopifyToken();
    timings.token_ms = elapsed();

    const productMap = await loadProductMap(db);
    timings.product_map_ms = elapsed();
    timings.product_map_size = productMap.size;

    const store = process.env.SHOPIFY_STORE_DOMAIN;
    const now = admin.firestore.FieldValue.serverTimestamp();

    let url;
    if (state.next_url) {
      url = state.next_url;
    } else {
      const minDate = new Date();
      minDate.setDate(minDate.getDate() - BACKFILL_DAYS);
      const minISO = minDate.toISOString();
      url = `https://${store}/admin/api/${SHOPIFY_API_VERSION}/orders.json?limit=${PAGE_SIZE}&status=any&created_at_min=${minISO}`;
      await syncRef.set(
        {
          created_at_min: minISO,
          complete: false,
          orders_processed: 0,
          line_items_written: 0,
          skipped_orders: 0,
          started_at: now,
          last_status: "in_progress",
        },
        { merge: true }
      );
    }

    let ordersProcessed = state.orders_processed || 0;
    let lineItemsWritten = state.line_items_written || 0;
    let skippedOrders = state.skipped_orders || 0;
    let oldestFetched = state.oldest_fetched || null;
    let pagesThisRun = 0;
    let unmatchedVariants = state.unmatched_variants || 0;

    timings.loop_start_ms = elapsed();

    while (url) {
      if (elapsed() > DEADLINE_MS - PAGE_RESERVE_MS) break;

      const res = await fetch(url, {
        headers: { "X-Shopify-Access-Token": token },
      });

      if (!res.ok) {
        const text = await res.text();
        if (res.status === 429) break;
        if (res.status === 400 && state.next_url && oldestFetched) {
          url = `https://${store}/admin/api/${SHOPIFY_API_VERSION}/orders.json?limit=${PAGE_SIZE}&status=any&created_at_min=${state.created_at_min}&created_at_max=${oldestFetched}`;
          await syncRef.set({ next_url: null }, { merge: true });
          continue;
        }
        throw new Error(`Shopify ${res.status}: ${text.slice(0, 300)}`);
      }

      const body = await res.json();
      const orders = body.orders || [];

      // ── Skip orders already written (handles mid-page crash resume) ──
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

      // ── BulkWriter for concurrent batched writes ──────────────────
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
            if (!product) unmatchedVariants++;

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
          if (!oldestFetched || order.created_at < oldestFetched) {
            oldestFetched = order.created_at;
          }
        }

        await writer.close();
      }

      // ── Track oldest across ALL orders on the page (including skipped) ──
      for (const order of orders) {
        if (!oldestFetched || order.created_at < oldestFetched) {
          oldestFetched = order.created_at;
        }
      }

      url = parseNextUrl(res.headers.get("link"));
      pagesThisRun++;

      // ── Checkpoint after every page ───────────────────────────────
      await syncRef.set(
        {
          next_url: url || null,
          orders_processed: ordersProcessed,
          line_items_written: lineItemsWritten,
          skipped_orders: skippedOrders,
          oldest_fetched: oldestFetched,
          unmatched_variants: unmatchedVariants,
          last_run_at: now,
          last_status: url ? "in_progress" : "success",
          complete: !url,
        },
        { merge: true }
      );
    }

    const complete = !url;
    timings.loop_end_ms = elapsed();

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orders_processed: ordersProcessed,
        line_items_written: lineItemsWritten,
        skipped_orders: skippedOrders,
        unmatched_variants: unmatchedVariants,
        oldest_fetched: oldestFetched,
        pages_this_run: pagesThisRun,
        complete,
        duration_ms: elapsed(),
        timings,
        message: complete
          ? "Backfill complete."
          : "Time budget reached — call again to resume from checkpoint.",
      }),
    };
  } catch (err) {
    try {
      await syncRef.set(
        {
          last_run_at: admin.firestore.FieldValue.serverTimestamp(),
          last_status: "error",
          last_error: err.message,
          duration_ms: elapsed(),
        },
        { merge: true }
      );
    } catch (_) {}

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: err.message,
        timings,
        duration_ms: elapsed(),
      }),
    };
  }
};

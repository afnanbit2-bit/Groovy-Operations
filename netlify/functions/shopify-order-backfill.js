const admin = require("firebase-admin");

const SHOPIFY_API_VERSION = "2026-04";
const BACKFILL_DAYS = 90;
const MAX_DAYS = 3650;
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

// ── Window parameter: ?days=N (1..3650) or ?since=YYYY-MM-DD ─────
// Returns {minISO, label} or {error}. No parameter => the original 90 days.
function parseWindow(event, nowMs) {
  const q = (event && event.queryStringParameters) || {};
  const hasDays = q.days !== undefined && q.days !== "";
  const hasSince = q.since !== undefined && q.since !== "";
  if (hasDays && hasSince) return { error: "Pass days OR since, not both." };
  if (hasSince) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(q.since));
    const d = m && new Date(`${q.since}T00:00:00.000Z`);
    if (!d || isNaN(d) || d.toISOString().slice(0, 10) !== q.since) {
      return { error: "since must be a real date, YYYY-MM-DD." };
    }
    if (d.getTime() > nowMs) return { error: "since cannot be in the future." };
    if (nowMs - d.getTime() > MAX_DAYS * 86400000) {
      return { error: `since is more than ${MAX_DAYS} days ago.` };
    }
    return { minISO: d.toISOString(), label: `since ${q.since}` };
  }
  let days = BACKFILL_DAYS;
  if (hasDays) {
    if (!/^\d+$/.test(String(q.days))) {
      return { error: `days must be a whole number 1..${MAX_DAYS}.` };
    }
    days = parseInt(q.days, 10);
    if (days < 1 || days > MAX_DAYS) {
      return { error: `days must be a whole number 1..${MAX_DAYS}.` };
    }
  }
  const minDate = new Date(nowMs);
  minDate.setDate(minDate.getDate() - days);
  return { minISO: minDate.toISOString(), label: `${days} days` };
}

// ── Handler ─────────────────────────────────────────────────────
exports.handler = async function (event) {
  const start = Date.now();
  const win = parseWindow(event, start);
  if (win.error) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: win.error }),
    };
  }
  const explicitWindow = !!(
    event &&
    event.queryStringParameters &&
    (event.queryStringParameters.days || event.queryStringParameters.since)
  );
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

    // A finished backfill is only re-opened by an EXPLICIT window reaching
    // further back than the one it covered; it then fetches just the older
    // slice (created_at_max = the old minimum). Existing orders are skipped
    // by id as always, so nothing already written is touched.
    let extendFrom = null;
    if (
      state.complete &&
      explicitWindow &&
      state.created_at_min &&
      win.minISO < state.created_at_min
    ) {
      extendFrom = state.created_at_min;
    }

    if (state.complete && !extendFrom) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message:
            "Backfill already complete. Delete shopify_sync_meta/order_backfill to re-run.",
          orders_processed: state.orders_processed,
          line_items_written: state.line_items_written,
          complete: true,
          created_at_min: state.created_at_min || null,
          hint: "To go further back, call again with ?days=N (max 3650) or ?since=YYYY-MM-DD earlier than created_at_min.",
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
    let windowMin = state.created_at_min || null;
    if (state.next_url && !extendFrom) {
      url = state.next_url; // resume: the stored window wins over any parameter
    } else {
      const minISO = win.minISO;
      windowMin = minISO;
      const maxPart = extendFrom ? `&created_at_max=${extendFrom}` : "";
      url = `https://${store}/admin/api/${SHOPIFY_API_VERSION}/orders.json?limit=${PAGE_SIZE}&status=any&created_at_min=${minISO}${maxPart}`;
      state.next_url = null;
      state.oldest_fetched = null;
      state.orders_processed = 0;
      state.line_items_written = 0;
      state.skipped_orders = 0;
      state.unmatched_variants = 0;
      await syncRef.set(
        {
          created_at_min: minISO,
          complete: false,
          next_url: null,
          oldest_fetched: null,
          orders_processed: 0,
          line_items_written: 0,
          skipped_orders: 0,
          started_at: now,
          last_status: "in_progress",
          ...(extendFrom ? { extended_from: extendFrom } : {}),
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
          url = `https://${store}/admin/api/${SHOPIFY_API_VERSION}/orders.json?limit=${PAGE_SIZE}&status=any&created_at_min=${windowMin}&created_at_max=${oldestFetched}`;
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
              // Codes used on the order, upper-cased — read by the Marketing
              // redemption rollup (marketing-code-rollup.js) with an
              // array-contains query.
              discount_codes: (order.discount_codes || [])
                .map((d) => String((d && d.code) || "").toUpperCase())
                .filter(Boolean),
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
        window: windowMin,
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

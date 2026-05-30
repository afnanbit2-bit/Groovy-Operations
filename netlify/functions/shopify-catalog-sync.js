const admin = require("firebase-admin");

const SHOPIFY_API_VERSION = "2026-04";
const BATCH_LIMIT = 500;

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

async function fetchAllProducts(token) {
  const store = process.env.SHOPIFY_STORE_DOMAIN;
  let url = `https://${store}/admin/api/${SHOPIFY_API_VERSION}/products.json?limit=250&status=active,draft,archived`;
  const all = [];

  while (url) {
    const res = await fetch(url, {
      headers: { "X-Shopify-Access-Token": token },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Shopify ${res.status}: ${text}`);
    }
    const body = await res.json();
    all.push(...(body.products || []));
    url = parseNextUrl(res.headers.get("link"));
  }
  return all;
}

// ── Option-position validator ───────────────────────────────────
function checkOptions(product) {
  const opts = product.options || [];
  const o1 = opts.find((o) => o.position === 1);
  const o2 = opts.find((o) => o.position === 2);
  const o1Name = o1 ? o1.name : null;
  const o2Name = o2 ? o2.name : null;
  const ok =
    (!o1Name || o1Name.toLowerCase() === "color") &&
    (!o2Name || o2Name.toLowerCase() === "size");
  return { ok, o1Name, o2Name };
}

// ── Handler ─────────────────────────────────────────────────────
exports.handler = async function () {
  const start = Date.now();
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
  const syncRef = db.collection("shopify_sync_meta").doc("catalog_sync");

  try {
    const token = await getShopifyToken();
    const products = await fetchAllProducts(token);

    const now = admin.firestore.FieldValue.serverTimestamp();
    let variantCount = 0;
    let flaggedCount = 0;
    const flaggedDetails = [];

    let batch = db.batch();
    let inBatch = 0;

    for (const product of products) {
      const { ok, o1Name, o2Name } = checkOptions(product);
      const needsReview = !ok;

      if (needsReview) {
        flaggedCount++;
        if (flaggedDetails.length < 50) {
          flaggedDetails.push({
            product_id: product.id,
            title: product.title,
            option1_name: o1Name,
            option2_name: o2Name,
          });
        }
      }

      for (const v of product.variants || []) {
        const ref = db.collection("shopify_products").doc(String(v.id));
        batch.set(ref, {
          sku: v.sku || "",
          product_id: product.id,
          product_title: product.title,
          color: v.option1 || "",
          size: v.option2 || "",
          option3: v.option3 || "",
          price: parseFloat(v.price) || 0,
          inventory_item_id: v.inventory_item_id || null,
          product_type: product.product_type || "",
          tags: (product.tags || "")
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          status: product.status || "",
          created_at: product.created_at || "",
          last_synced_at: now,
          needs_review: needsReview,
        });

        variantCount++;
        inBatch++;

        if (inBatch >= BATCH_LIMIT) {
          await batch.commit();
          batch = db.batch();
          inBatch = 0;
        }
      }
    }

    if (inBatch > 0) await batch.commit();

    const summary = {
      last_run_at: now,
      last_success_at: now,
      last_status: "success",
      last_error: null,
      products_fetched: products.length,
      variants_written: variantCount,
      flagged_products: flaggedCount,
      flagged_details: flaggedDetails,
      duration_ms: Date.now() - start,
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
          duration_ms: Date.now() - start,
        },
        { merge: true }
      );
    } catch (_) {}

    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};

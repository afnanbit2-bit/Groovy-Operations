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

// ── Article rollup (Pattern Hub M1) ─────────────────────────────
// A Shopify SKU is the Groovy article code plus a size suffix — GST073-XS,
// GD007-28, GHW001 (caps carry no size). One rollup doc per article code
// (~336) lets the Pattern Hub read liveness without paying for the whole
// per-variant catalog (~1,500 docs) on every visit — the read-quota lesson
// from js/store.js. Anything that does not parse as an article code (an
// empty SKU, TOPS-030, FOG-02) is listed on the meta doc as "unkeyed" so the
// reconcile page can offer a title match; nothing here writes to Shopify.
const ARTICLE_SKU_RE = /^([A-Z]{2,3}\d{3,}(?:-[TB])?)(?:-([A-Z0-9]+))?$/;
function parseArticleSku(sku) {
  const m = ARTICLE_SKU_RE.exec(String(sku || "").trim().toUpperCase());
  return m ? { code: m[1], size: m[2] || "" } : null;
}
function sizeAxisOf(sizes) {
  const s = sizes.filter(Boolean);
  if (!s.length) return "none";
  const numeric = s.filter((x) => /^\d+$/.test(x)).length;
  if (numeric === s.length) return "waist";
  if (numeric === 0) return "alpha";
  return "mixed";
}
function rollupStatus(statuses) {
  if (statuses.has("active")) return "active";
  if (statuses.has("draft")) return "draft";
  if (statuses.has("archived")) return "archived";
  return "unknown";
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

    const rollup = new Map();   // code → accumulator
    const unkeyed = [];         // products with no parseable article code
    const multiCode = [];       // products whose variants carry >1 code

    for (const product of products) {
      const imageUrl = (product.image && product.image.src) || "";
      const codesInProduct = new Set();
      const foreign = [];
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
          image_url: imageUrl,
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

        const parsed = parseArticleSku(v.sku);
        if (!parsed) {
          if (String(v.sku || "").trim()) foreign.push(String(v.sku).trim());
        } else {
          codesInProduct.add(parsed.code);
          let r = rollup.get(parsed.code);
          if (!r) {
            r = { code: parsed.code, statuses: new Set(), productIds: new Set(), productTitles: new Set(), variantCount: 0, sizes: new Set(), imageUrl: "" };
            rollup.set(parsed.code, r);
          }
          r.statuses.add(product.status || "");
          r.productIds.add(String(product.id));
          r.productTitles.add(product.title || "");
          r.variantCount++;
          if (parsed.size) r.sizes.add(parsed.size);
          if (!r.imageUrl && imageUrl) r.imageUrl = imageUrl;
        }

        if (inBatch >= BATCH_LIMIT) {
          await batch.commit();
          batch = db.batch();
          inBatch = 0;
        }
      }

      if (codesInProduct.size > 1) {
        multiCode.push({ product_id: String(product.id), title: product.title || "", status: product.status || "", codes: Array.from(codesInProduct) });
      }
      if (codesInProduct.size === 0) {
        unkeyed.push({
          product_id: String(product.id), title: product.title || "", status: product.status || "",
          product_type: product.product_type || "", image_url: imageUrl,
          reason: foreign.length ? "foreign_sku" : "no_sku", sku_sample: foreign[0] || "",
        });
      }
    }

    if (inBatch > 0) await batch.commit();

    // ── Article rollup: write every code seen, delete the ones that vanished ──
    const existing = await db.collection("shopify_articles").get();
    const seen = new Set();
    let rbatch = db.batch(), rn = 0, articlesWritten = 0, articlesDeleted = 0;
    const flushRollup = async () => { if (rn) { await rbatch.commit(); rbatch = db.batch(); rn = 0; } };
    for (const r of rollup.values()) {
      seen.add(r.code);
      const sizes = Array.from(r.sizes);
      rbatch.set(db.collection("shopify_articles").doc(r.code), {
        code: r.code,
        status: rollupStatus(r.statuses),
        statuses: Array.from(r.statuses),
        product_ids: Array.from(r.productIds),
        product_titles: Array.from(r.productTitles),
        variant_count: r.variantCount,
        sizes_seen: sizes,
        size_axis: sizeAxisOf(sizes),
        image_url: r.imageUrl,
        last_seen_at: now,
      });
      articlesWritten++;
      if (++rn >= BATCH_LIMIT) await flushRollup();
    }
    for (const d of existing.docs) {
      if (seen.has(d.id)) continue;
      rbatch.delete(d.ref);
      articlesDeleted++;
      if (++rn >= BATCH_LIMIT) await flushRollup();
    }
    await flushRollup();
    await db.collection("shopify_sync_meta").doc("articles_rollup").set({
      last_success_at: now,
      codes: articlesWritten,
      unkeyed_count: unkeyed.length,
      multi_code_count: multiCode.length,
      unkeyed_products: unkeyed.slice(0, 200),
      multi_code_products: multiCode.slice(0, 100),
    });

    const summary = {
      last_run_at: now,
      last_success_at: now,
      last_status: "success",
      last_error: null,
      products_fetched: products.length,
      variants_written: variantCount,
      flagged_products: flaggedCount,
      flagged_details: flaggedDetails,
      articles_written: articlesWritten,
      articles_deleted: articlesDeleted,
      unkeyed_products: unkeyed.length,
      multi_code_products: multiCode.length,
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

// Exposed for tests/catalog-sync.test.js only.
exports._test = { parseArticleSku, sizeAxisOf, rollupStatus };

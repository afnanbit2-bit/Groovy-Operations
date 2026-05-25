const admin = require("firebase-admin");

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

function pktDateStr(offsetDays) {
  const d = new Date(Date.now() + 5 * 3600000);
  if (offsetDays) d.setDate(d.getDate() + offsetDays);
  return d.toISOString().split("T")[0];
}

// ── Handler ─────────────────────────────────────────────────────
exports.handler = async function () {
  const start = Date.now();
  const elapsed = () => Date.now() - start;

  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Missing FIREBASE_SERVICE_ACCOUNT" }),
    };
  }

  const db = getDb();
  const saturdayDate = pktDateStr(0);
  const sundayDate = pktDateStr(-6);
  const nextSundayDate = pktDateStr(1);
  const lastSaturdayDate = pktDateStr(-7);

  try {
    // ── 1. Fetch this week's line items from Firestore ──────────
    const liSnap = await db
      .collection("shopify_line_items")
      .where("order_created_at", ">=", sundayDate)
      .where("order_created_at", "<", nextSundayDate)
      .get();

    let unitsSold = 0;
    const byCategory = {};
    const bySize = {};
    const byColor = {};
    const bySku = {};

    liSnap.forEach((doc) => {
      const d = doc.data();
      const qty = d.quantity || 0;
      unitsSold += qty;

      const cat = d.product_type || "Unknown";
      byCategory[cat] = (byCategory[cat] || 0) + qty;

      const sz = d.size || "Unknown";
      bySize[sz] = (bySize[sz] || 0) + qty;

      const clr = d.color || "Unknown";
      byColor[clr] = (byColor[clr] || 0) + qty;

      const sku = d.sku || "Unknown";
      bySku[sku] = (bySku[sku] || 0) + qty;
    });

    // ── 2. Top SKU + top category ───────────────────────────────
    const topSku = Object.entries(bySku).sort((a, b) => b[1] - a[1])[0];
    const topCategory = Object.entries(byCategory).sort(
      (a, b) => b[1] - a[1]
    )[0];

    // ── 3. Inventory snapshot deltas ────────────────────────────
    const thisSnap = await db
      .collection("shopify_inventory_snapshots")
      .doc(saturdayDate)
      .get();
    const lastSnap = await db
      .collection("shopify_inventory_snapshots")
      .doc(lastSaturdayDate)
      .get();

    let thisTotal = null;
    let lastTotal = null;
    let unitsAdded = null;
    let netChange = null;

    if (thisSnap.exists) {
      thisTotal = thisSnap.data().total_available ?? null;
    }
    if (lastSnap.exists) {
      lastTotal = lastSnap.data().total_available ?? null;
    }
    if (thisTotal !== null && lastTotal !== null) {
      netChange = thisTotal - lastTotal;
      unitsAdded = netChange + unitsSold;
    }

    // ── 4. Write weekly close doc ───────────────────────────────
    const now = admin.firestore.FieldValue.serverTimestamp();
    const closeDoc = {
      week_ending: saturdayDate,
      week_starting: sundayDate,
      closed_at: now,
      units_sold: unitsSold,
      units_added: unitsAdded,
      net_change: netChange,
      this_week_available: thisTotal,
      last_week_available: lastTotal,
      top_sku: topSku ? { sku: topSku[0], quantity: topSku[1] } : null,
      top_category: topCategory
        ? { category: topCategory[0], quantity: topCategory[1] }
        : null,
      line_items_counted: liSnap.size,
      by_category: byCategory,
      by_size: bySize,
      by_color: byColor,
    };

    await db
      .collection("shopify_weekly_closes")
      .doc(saturdayDate)
      .set(closeDoc);

    const summary = {
      week_ending: saturdayDate,
      units_sold: unitsSold,
      units_added: unitsAdded,
      net_change: netChange,
      top_sku: closeDoc.top_sku,
      top_category: closeDoc.top_category,
      line_items_counted: liSnap.size,
      categories: Object.keys(byCategory).length,
      duration_ms: elapsed(),
    };

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(summary),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message, duration_ms: elapsed() }),
    };
  }
};

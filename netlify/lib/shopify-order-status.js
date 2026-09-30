/* shopify-order-status — the ONE definition of the "status" fields an order
 * and its line items carry in Firestore (financial_status, cancelled_at,
 * refunded_quantity, refunded_at). Used by shopify-order-sync.js and
 * shopify-order-backfill.js (new docs) and shopify-order-refresh.js (updates
 * in place), so a refund can never mean one thing at first sync and another
 * at refresh.
 *
 * Reads the REST orders.json shape: order.refunds[].created_at and
 * order.refunds[].refund_line_items[].{line_item_id, quantity}. Pure.
 */
"use strict";

// { [line_item_id]: { qty, at } } — qty summed over every refund, at = latest refund created_at.
function refundsByLine(order) {
  const out = {};
  for (const r of (order && order.refunds) || []) {
    for (const rli of (r && r.refund_line_items) || []) {
      const id = String(rli.line_item_id);
      const cur = out[id] || { qty: 0, at: null };
      cur.qty += Number(rli.quantity) || 0;
      if (r.created_at && (!cur.at || r.created_at > cur.at)) cur.at = r.created_at;
      out[id] = cur;
    }
  }
  return out;
}

function latestRefundAt(order) {
  let at = null;
  for (const r of (order && order.refunds) || []) {
    if (r && r.created_at && (!at || r.created_at > at)) at = r.created_at;
  }
  return at;
}

function orderStatusFields(order) {
  return {
    financial_status: order.financial_status || "",
    cancelled_at: order.cancelled_at || null,
    refunded_at: latestRefundAt(order),
  };
}

function lineStatusFields(order, li, byLine) {
  const r = (byLine || refundsByLine(order))[String(li.id)];
  return {
    financial_status: order.financial_status || "",
    cancelled_at: order.cancelled_at || null,
    refunded_quantity: r ? r.qty : 0,
    refunded_at: r ? r.at : null,
  };
}

module.exports = { refundsByLine, latestRefundAt, orderStatusFields, lineStatusFields };

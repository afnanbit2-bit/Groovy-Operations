// Netlify Function: fetch current inventory levels from Shopify Admin API (read-only)
const SHOPIFY_API_VERSION = "2024-10";

exports.handler = async function (event) {
  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  const store = process.env.SHOPIFY_STORE_DOMAIN;

  if (!token || !store) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Missing SHOPIFY_ADMIN_TOKEN or SHOPIFY_STORE_DOMAIN env vars",
      }),
    };
  }

  const baseUrl = `https://${store}/admin/api/${SHOPIFY_API_VERSION}`;

  try {
    // Step 1: Fetch locations (single location expected)
    const locRes = await fetch(`${baseUrl}/locations.json`, {
      headers: { "X-Shopify-Access-Token": token },
    });

    if (!locRes.ok) {
      const text = await locRes.text();
      return {
        statusCode: locRes.status,
        body: JSON.stringify({
          error: "Shopify locations request failed",
          status: locRes.status,
          detail: text,
        }),
      };
    }

    const { locations } = await locRes.json();
    const locationId = locations[0]?.id;

    if (!locationId) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: "No locations found" }),
      };
    }

    // Step 2: Fetch inventory levels for that location (first page, up to 250)
    const invRes = await fetch(
      `${baseUrl}/inventory_levels.json?location_ids=${locationId}&limit=50`,
      { headers: { "X-Shopify-Access-Token": token } }
    );

    if (!invRes.ok) {
      const text = await invRes.text();
      return {
        statusCode: invRes.status,
        body: JSON.stringify({
          error: "Shopify inventory_levels request failed",
          status: invRes.status,
          detail: text,
        }),
      };
    }

    const { inventory_levels } = await invRes.json();

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: true,
        location: { id: locationId, name: locations[0].name },
        sample_count: inventory_levels.length,
        inventory_levels,
        scopes_confirmed: "read_inventory, read_products, read_locations",
        note: "This function is strictly read-only. No write operations.",
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
